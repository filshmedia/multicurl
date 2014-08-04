/*jshint loopfunc: true */
'use strict';
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var _ = require('underscore');
var Connection = require('./connection');
var FileMerger = require('./filemerger');

function multicurl (url, options) {
  if(!options) options = {};

  /*jshint validthis:true*/
  this.url = url;
  this.options = options;
  this.defaults = {
    debug: false,
    connections: 1,
    maxRetries: 3,
    timeout: 10000,
    headers: {}
  };
  this.errorneous = false;
  this.connections = [];

  // Merge options with defaults
  this.options = _.defaults(this.options, this.defaults);
}
util.inherits(multicurl, EventEmitter);

/**
 * Returns an array of cli commands that would be run
 * @param  {Function} callback
 * @public
 */
multicurl.prototype.getCommands = function (callback) {
  var commands = [];
  var self = this;

  // Get total file size
  this.getFilesize(function (err, totalFilesize) {
    if (err) return callback(err);

    // Build the ranges and connections
    for (var i = 0; i < self.options.connections; i++) {
      var options = _.clone(self.options);
      options.range = self._buildRange(totalFilesize, i);
      options.destination += '.' + i;

      var connection = new Connection(self.url, options);
      commands.push(connection.getCommand());
    }

    callback(null, commands);
  });
};

/**
 * Gets the total file size, initializes the Connection objects
 * and starts the download
 * @public
 */
multicurl.prototype.run = function () {
  var self = this;

  if (!this.options.destination) throw new Error('No destination given');

  // Get total file size
  this.getFilesize(function (err, totalFilesize) {
    if (err) return self.emit('error', err);

    self.emit('filesize', totalFilesize);

    var connectionsDone = 0;

    // Build the ranges and connections
    for (var i = 0; i < self.options.connections; i++) {
      var options = _.clone(self.options);
      options.range = self._buildRange(totalFilesize, i);
      options.destination += '.' + i;
      var connection = new Connection(self.url, options);

      /**
       * @todo Create a timer that emits the progress event every x seconds
       */
      connection.on('progress', function () {
        // Sum up the amounts
        var totalBytesDone = 0;
        for(var i = 0; i < self.connections.length; i++) {
          var connection = self.connections[i];
          totalBytesDone += connection.bytesDone;
        }

        self.emit('progress', totalBytesDone, totalFilesize);
      });

      connection.on('error', function (err) {
        if(!self.errorneous) { // only emit once
          self.emit('error', err);
          self.errorneous = true;
        }
      });

      // Notify client about retries
      connection.on('retry', function (retry, connectionIndex) {
        self.emit('retry', retry, connectionIndex);
      });

      // As soon as all connections are done, merge the files
      connection.on('done', function () {
        connectionsDone++;
        if(connectionsDone === self.options.connections) {
          self._mergeFiles();
        }
      });

      connection.run();

      self.connections.push(connection);
    }
  });
};

/**
 * Builds the range for the given total file size and the connection index
 * @param  {Number} totalFilesize
 * @param  {Number} index
 * @return {Object}
 * @private
 */
multicurl.prototype._buildRange = function(totalFilesize, index) {
  var sizePerConnection = Math.floor(totalFilesize / this.options.connections);
  var fromByte = sizePerConnection * index;
  var toByte   = fromByte + sizePerConnection - 1;

  // Remove one byte from the last connection
  if(index == this.options.connections - 1) {
    toByte = totalFilesize - 1;
  }

  return { from: fromByte, to: toByte, size: toByte - fromByte + 1 };
};

/**
 * Merge all files usign the FileMerger
 * @param  {Array} connections
 * @private
 */
multicurl.prototype._mergeFiles = function() {
  var fileMerger = new FileMerger(this.connections);
  var self = this;

  // Delegate `error` and `done` events
  fileMerger.on('error', function (err) {
    self.emit('error', err);
  }).on('done', function () {
    self.emit('done');
  });

  // Merge file chunks to destination
  fileMerger.run(this.options.destination);
};

/**
 * Finds out the total file size of the given URL
 * @param  {String}   url
 * @param  {Function} callback [description]
 * @todo Move to curl (request uses lowercase headers and e.g. dailymotion
 *       does not support that)
 * @public
 */
multicurl.prototype.getFilesize = function(url, callback) {
  var self = this;
  if (typeof url !== 'string') {
    callback = url;
    url = this.url;
  }

  var options = _.extend({}, options, { headersOnly: true });
  var connection = new Connection(url, options);
  connection.on('error', function (err) {
    self.emit('error', err);
  });
  connection.on('headers', function (headers) {
    var contentLength = headers['content-length'];

    if (contentLength) {
      callback(null, parseInt(contentLength));
    } else {
      callback(null, 0);
    }
  });
  connection.run();
};

/**
 * Stops all connections
 * @public
 */
multicurl.prototype.stop = function () {
  this.connections.forEach(function (connection) {
    connection.stop();
  });
};

module.exports = multicurl;
