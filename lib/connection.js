var util         = require("util")
  , EventEmitter = require("events").EventEmitter
  , spawn        = require("child_process").spawn;

function Connection(url, options) {
  this.url = url;
  this.options = options;
};
util.inherits(Connection, EventEmitter);

Connection.prototype.run = function() {
  var args = this.buildArguments(this.options);
  args = args.concat(["--range", this.options.range.from + "-" + this.options.range.to])
  args.push(this.url);

  this.bytesDone = 0;

  var p = spawn("curl", args)
    , buffer = ""
    , self = this;

  // Listen for exit
  p.on("exit", function(exitCode) {
    if(exitCode !== 0) {
      self.emit("error", new Error("CURL exited with code " + exitCode));
    } else {
      self.bytesDone = self.options.range.size;
      self.emit("progress", self.options.range.size);
      self.emit("done");
    }
  });

  // Listen for stderr output
  p.stderr.on("data", function (chunk) {
    chunk = chunk.toString();
    buffer += chunk;

    // Find last line that ends with a \r
    var lineSplit = buffer.split("\r")
      , lastLine  = null;

    // Find the last valid line
    for(var i = 0; i < lineSplit.length; i++) {
      var line = lineSplit[i].replace(/\r/g, "").replace(/\s+/g, " ").replace(/^\s+|\s+$/, "");

      // We have reached our last and incomplete line
      if(line.split(" ").length === 12) {
        lastLine = line;
      }
    }

    if(lastLine) {
      // Split the line and parse the file size
      var wordSplit = lastLine.split(" ")
        , transferred = wordSplit[3]
        , transferredInt = parseInt(wordSplit[3])
        , match;

      if(match = transferred.match(/([0-9]*\.?[0-9]+)([M|k]?)/)) {
        switch(match[2]) {
          case "k":
            transferredInt *= 1024
            break;
          case "M":
            transferredInt *= 1024 * 1024
            break;
        }

        self.bytesDone = transferredInt;

        // Emit a new progress event
        self.emit("progress", transferredInt);
      }
    }

  });
};

Connection.prototype.buildArguments = function(options) {
  var args = [];

  // Destination
  args = args.concat(["-o", this.options.destination]);

  return args;
};

module.exports = Connection;