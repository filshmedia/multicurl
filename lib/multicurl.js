var util         = require("util")
  , spawn        = require("child_process").spawn
  , EventEmitter = require("events").EventEmitter
  , Connection   = require("./connection")
  , FileMerger   = require("./filemerger")
  , _            = require("underscore")
  , request      = require("request");

function multicurl(url, options) {
  if(!options) var options = {};

  this.url = url;
  this.options = options;
  this.defaults = {
    connections: 1,
    maxRetries: 3,
    timeout: 10000,
    headers: {}
  };
  this.errorneous = false;
  this.connections = [];

  // Merge options with defaults
  this.options = _.defaults(this.options, this.defaults);
};
util.inherits(multicurl, EventEmitter);

// Returns the curl commands that would be run
multicurl.prototype.getCommands = function(callback) {
  var commands = [];
  var self = this;

  // Get total file size
  this.getFilesize(function (err, totalFilesize) {
    if(err) return callback(err);

    // Build the ranges and connections
    for(var i = 0; i < self.options.connections; i++) {
      var options = _.clone(self.options);
      options.range = self.buildRange(totalFilesize, i);
      options.destination += "." + i;
      var connection = new Connection(self.url, options);

      commands.push(connection.getCommand());
    }

    callback(null, commands);
  })
};

// Starts the download process
multicurl.prototype.run = function() {
  var self = this;

  if(!this.options.destination) throw new Error("No destination given");

  // Get total file size
  this.getFilesize(
    function (err, totalFilesize) {
    if(err) return self.emit("error", err);

    self.emit("filesize", totalFilesize);

    var connectionsDone = 0;

    // Build the ranges and connections
    for(var i = 0; i < self.options.connections; i++) {
      var options = _.clone(self.options);
      options.range = self.buildRange(totalFilesize, i);
      options.destination += "." + i;
      var connection = new Connection(self.url, options);

      // Connections send out
      connection.on("progress", function (bytesDone) {
        // Sum up the amounts
        var totalBytesDone = 0;
        for(var i = 0; i < self.connections.length; i++) {
          var connection = self.connections[i];
          totalBytesDone += connection.bytesDone;
        }

        self.emit("progress", totalBytesDone, totalFilesize);
      });

      connection.once("error", function (err) {
        if(!self.errorneous) {
          self.emit("error", err);
          self.errorneous = true;
        }
      });

      connection.on("retry", function (retry, connectionIndex) {
        self.emit("retry", retry, connectionIndex);
      });

      connection.on("done", function () {
        connectionsDone++;
        if(connectionsDone === self.options.connections) {
          self.mergeFiles(self.connections);
        }
      });
      connection.run();
      self.connections.push(connection);
    }
  })
};

// Build range string
multicurl.prototype.buildRange = function(totalFilesize, index) {
  var sizePerConnection = Math.floor(totalFilesize / this.options.connections)
    , fromByte = sizePerConnection * index
    , toByte   = fromByte + sizePerConnection - 1;

  if(index == this.options.connections - 1) {
    toByte = totalFilesize - 1;
  }
  return { from: fromByte, to: toByte, size: toByte - fromByte + 1 };
}

// Merge the files that have been downloaded by the connections
multicurl.prototype.mergeFiles = function(connections) {
  var fileMerger = new FileMerger(connections)
    , self = this;

  fileMerger.on("error", function (err) {
    self.emit("error", err);
  });
  fileMerger.on("done", function () {
    self.emit("done");
  });
  fileMerger.run(this.options.destination);
};

// Finds out the total file size
multicurl.prototype.getFilesize = function(url, callback) {
  if (typeof url !== "string") {
    callback = url;
    url = this.url;
  }
  var self = this;

  var req = request(url, {
    proxy: this.options.proxy
  });
  req.on('response', function (response) {
    if (response.statusCode !== 200) {
      return callback(new Error("The requested URL returned error: " + response.statusCode));
    }
    response.connection.destroy();
    callback(null, parseInt(response.headers['content-length']));
  });
  req.on('error', function (err) {
    callback(err);
  });
};

// Stops all connections
multicurl.prototype.stop = function () {
  this.connections.forEach(function (connection) {
    connection.stop();
  });
};

module.exports = multicurl;
