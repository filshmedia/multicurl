'use strict';
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var spawn = require('child_process').spawn;
var _ = require('underscore');

function Connection(url, options) {
  this.url = url;
  this.statusCode = null;
  this.options = options;
  this.options = _.defaults(this.options, {
    timeout: 10
  });
  this.retries = 0;
}
util.inherits(Connection, EventEmitter);

/**
 * Downloads a chunk
 * @public
 */
Connection.prototype.run = function() {
  var args = this._buildArguments();

  this.bytesDone = 0;

  var self = this;
  var buffer = '';

  this.process = spawn('curl', args);

  this.process.on('error', function (e) {
    self.emit('error', e);
  });

  // Listen for exit
  this.process.on('exit', function(exitCode) {
    if(exitCode !== 0 && exitCode !== null) {
      if(self.retries < self.options.maxRetries) {
        self.retries++;
        self.emit('retry', self.retries, self.options.index);

        self.run();
      } else {
        var error = self._getErrorFromString(buffer);
        if (!error) error = new Error('curl exited with code ' + exitCode);
        self.emit('error', error);
      }
    } else if(exitCode !== null) {
      if (!self.options.contentLengthOnly) {
        self.bytesDone = self.options.range.size;
        self.emit('progress', self.options.range.size);
      }
      self.emit('done');
    }
  });

  // this.process.stdout.on('data', function (chunk) {
  //   console.log('stdout');
  //   console.log(chunk.toString());
  // });

  // Listen for stderr output
  var headers = {};
  this.process.stderr.on('data', function (chunk) {
    chunk = chunk.toString();
    chunk = chunk.replace('\r', '\n');
    buffer += chunk;

    // Find last line that ends with a \n
    var lineSplit = buffer.split('\n');
    var lastLine  = null;

    // Find status code
    var matches = buffer.match(/HTTP\/.\..\s+([0-9]+)/ig);
    if (matches) {
      var lastMatch = matches[matches.length - 1];
      var match = lastMatch.match(/HTTP\/.\..\s+([0-9]+)/i);
      self.statusCode = parseInt(match[1]);
    }

    // Find the last valid line
    for(var i = 0; i < lineSplit.length; i++) {
      var line = lineSplit[i].replace(/\r/g, '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/, '');

      // We have reached our last and incomplete line
      if(line.split(' ').length === 12) {
        lastLine = line;
      }
    }

    if(lastLine) {
      // Split the line and parse the file size
      var wordSplit = lastLine.split(' ');
      var transferred = wordSplit[3];
      var transferredInt = parseInt(wordSplit[3]);
      var match = transferred.match(/([0-9]*\.?[0-9]+)([M|k]?)/);

      // Convert 123M / 123k formats to bytes
      if(match) {
        switch(match[2]) {
          case 'k':
            transferredInt *= 1024;
            break;
          case 'M':
            transferredInt *= 1024 * 1024;
            break;
        }

        self.bytesDone = transferredInt;

        // Emit a progress event
        self.emit('progress', transferredInt);

        // Parse headers
        // @todo: Move this to separate method
        if (self.options.contentLengthOnly) {
          if (self.fileSizeFound) return;

          if (self.statusCode !== null &&
            self.statusCode >= 200 &&
            self.statusCode < 300) {
              var matches = buffer.match(/content-length:\s+?([0-9]+)/ig);
              if (matches) {
                var lastMatch = matches[matches.length - 1];
                var match = lastMatch.match(/content-length:\s+?([0-9]+)/i);

                self.emit('filesize', parseInt(match[1]));
                self.stop();
                self.fileSizeFound = true;
                return;
              }
          }
        }
      }
    }
  });
};

/**
 * Builds an array of arguments for the curl process call
 * @return {Array}
 * @private
 */
Connection.prototype._buildArguments = function() {
  var args = [];

  // Destination
  if (this.options.destination) {
    args.push('-o', this.options.destination);
  } else {
    args.push('-o', '/dev/null');
  }

  // Connection timeout
  args.push('--connect-timeout', this.options.timeout);

  // Make it fail on status code > 400
  args.push('-f');

  // Range
  if (this.options.range) {
    args.push('--range', this.options.range.from + '-' + this.options.range.to);
  }

  // Header output only?
  if (this.options.contentLengthOnly) {
    args.push('-v');
  }

  // Follow redirects
  if (this.options.followRedirects) {
    args.push('-L');
  }

  // Limit download speed
  if (this.options.limitRate) {
    args.push('--limit-rate', this.options.limitRate);
  }

  // Send additional headers
  if (this.options.headers) {
    for (var name in this.options.headers) {
      var value = this.options.headers[name];
      args.push('-H', name + ':' + value);
    }
  }

  // Proxy settings
  if (this.options.proxy) {
    args.push('--proxy', this.options.proxy);
  }

  // The URL to fetch
  args.push(this.url);

  return args;
};

/**
 * Generates an Error from the given string
 * @param  {String} string
 * @return {Error}
 * @private
 */
Connection.prototype._getErrorFromString = function(string) {
  var stringSplit = string.split('\n');

  // Check for 'Warning:' string
  var warning = '';
  stringSplit.forEach(function (line) {
    var match = line.match(/Warning:\s+?(.*)/i);
    if (match) {
      warning += match[1];
    }
  });

  if (warning.length > 0) {
    return new Error(warning);
  }

  // Check for exit code and error
  var match = string.match(/curl:\s+?\(([0-9]+)\)\s+?(.*)\s+?\(?/i);
  if (match) {
    return new Error(match[2]);
  }

  // Default error
  return null;
};

/**
 * Returns a stringified version of the cli command
 * @return {String}
 * @public
 */
Connection.prototype.getCommand = function() {
  return ['curl'].concat(this._buildArguments()).join(' ');
};

/**
 * Stops the curl process (if running)
 * @public
 */
Connection.prototype.stop = function () {
  if(this.process) {
    this.process.kill('SIGKILL');
  }
};

module.exports = Connection;
