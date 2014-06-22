/*jshint loopfunc:true*/
'use strict';
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var exec = require('child_process').exec;
var fs = require('fs');

function FileMerger(connections) {
  this.connections = connections;
}
util.inherits(FileMerger, EventEmitter);

/**
 * Initiates the merging process
 * @param  {String} destination
 * @public
 */
FileMerger.prototype.run = function(destination) {
  var self = this;

  this._merge(destination, function (err) {
    if(err) return self.emit('error', err);
    self._cleanUp(function (err) {
      if(err) return self.emit('error', err);

      self.emit('done');
    });
  });
};

/**
 * Merges the files
 * @param  {String}   destination
 * @param  {Function} callback
 * @private
 */
FileMerger.prototype._merge = function (destination, callback) {
  // Build the arguments
  var args = '';
  var connection;

  for(var i = 0; i < this.connections.length; i++) {
    connection = this.connections[i];
    args += ' ' + connection.options.destination;
  }
  args += ' > ' + destination;

  // Run the process
  var p = exec('cat ' + args);
  p.on('exit', function (code) {
    if(code !== 0) {
      return callback(new Error('`cat` exited with status code ' + code));
    }
    callback();
  });
};

/**
 * Remove the temporary chunks
 * @param  {Function} callback
 * @private
 */
FileMerger.prototype._cleanUp = function (callback) {
  var filesDone = 0;
  var filesTotal = this.connections.length;
  var connection;

  for(var i = 0; i < filesTotal; i++) {
    connection = this.connections[i];
    fs.unlink(connection.options.destination, function () {
      filesDone ++;
      if(filesDone === filesTotal) {
        callback();
      }
    });
  }
};

module.exports = FileMerger;
