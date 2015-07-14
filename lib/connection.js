'use strict';
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var spawn = require('child_process').spawn;
var _ = require('underscore');

function Connection(url, options) {
  this.url = url;
  this.statusCode = null;
  this.options = options;
  this.buffer = ''
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
  this.buffer = ''

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

        if (typeof self.options.retryInterval !== 'undefined') {
          setTimeout(self.run.bind(self), self.options.retryInterval)
        } else {
          self.run()
        }
      } else {
        var error = self._getErrorFromString(self.buffer);
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

  // Listen for stderr output
  this.process.stderr.on('data', function (chunk) {
    chunk = chunk.toString();
    chunk = chunk.replace('\r', '\n');
    self.buffer += chunk;
    self._analyzeBuffer();
  });
};

/**
 * Analyzes the current content of the buffer, finds information that we need
 * @private
 */
Connection.prototype._analyzeBuffer = function () {
  var self = this;
  var statusCode, bytesDone, bytesTotal;
  var lineSplit;
  var match;
  var lines = self.buffer.split('\n');
  lines.forEach(function (line, lineNum) {
    line = line
      .replace(/\r/g, '') // Replace \r
      .replace(/\s+/g, ' ') // Trim multiple spaces
      .replace(/^\s+|\s+$/, ''); // Remove leading and trailing spaces

    // Does the line contain a status code?
    match = line.match(/HTTP\/.\..\s+([0-9]+)/ig);
    if (match) {
      statusCode = parseInt(match[1], 10);
      return;
    }

    // Does the line contain the content-length header?
    match = line.match(/content-length:\s+([0-9]+)/i);
    if (match) {
      bytesTotal = parseInt(match[1], 10);
    }

    // Does the line contain progress information?
    lineSplit = line.split(' ');
    if (lineSplit.length === 12) {
      var transferred = lineSplit[3];
      var transferredInt = parseInt(transferred, 10);
      var match = transferred.match(/([0-9]*\.?[0-9]+)([M|k]?)/);
      if (match) {
        bytesDone = self._convertSize(transferredInt, match[2]);
      }
    }
  });

  // Did `bytesDone` change? Emit a `progress` event
  if (this.bytesDone !== bytesDone && bytesDone !== 0) {
    this.bytesDone = bytesDone;
    this.emit('progress', bytesDone);
  }

  // Did `bytesTotal` change? Emit a `filesize` event
  if (this.bytesTotal !== bytesTotal && bytesTotal !== 0) {
    this.bytesTotal = bytesTotal;
    this.emit('filesize', bytesTotal);

    if (this.options.contentLengthOnly) {
      this.stop();
    }
  }

  // Update status code
  this.statusCode = statusCode;
};

/**
 * Gets a number and a unit, converts it to a real file size
 * @param  {Number} size
 * @param  {String} unit
 * @return {Number}
 * @private
 */
Connection.prototype._convertSize = function (size, unit) {
  switch (unit) {
    case 'k':
      size *= 1024;
      break;
    case 'M':
      size *= 1024 * 1024;
      break;
  }

  return size;
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
