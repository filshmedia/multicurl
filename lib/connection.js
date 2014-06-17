var util         = require("util")
  , EventEmitter = require("events").EventEmitter
  , spawn        = require("child_process").spawn;

function Connection(url, options) {
  this.url = url;
  this.options = options;
  this.retries = 0;
};
util.inherits(Connection, EventEmitter);

Connection.prototype.run = function() {
  var args = this.buildArguments(this.options);
  args = args.concat(["--range", this.options.range.from + "-" + this.options.range.to]);
  args = args.concat(["--connect-timeout", this.options.timeout]);
  args = args.concat(["-f"]); // Make it fail on status code > 400

  if (this.options.followRedirects) {
    args = args.concat(["-L"]);
  }

  if (this.options.headers) {
    for (var name in this.options.headers) {
      var value = this.options.headers[name];
      args = args.concat(["-H", name + ":" + value]);
    }
  }

  if (this.options.proxy) {
    args = args.concat(["--proxy", this.options.proxy]);
  }

  args.push(this.url);

  this.bytesDone = 0;
  var buffer = ""
    , self = this
    , warningBuffer = "";

  this.process = spawn("curl", args);
  this.process.on("error", function (e) {
    self.emit("error", e);
  });

  // Listen for exit
  this.process.on("exit", function(exitCode) {
    if(exitCode !== 0 && exitCode !== null) {
      if(self.retries < self.options.maxRetries) {
        self.retries++;
        self.emit("retry", self.retries, self.options.index);

        self.run();
      } else {
        var error = self._getErrorFromString(buffer);
        if (!error) error = new Error("curl exited with code " + exitCode);
        self.emit("error", error);
      }
    } else if(exitCode !== null) {
      self.bytesDone = self.options.range.size;
      self.emit("progress", self.options.range.size);
      self.emit("done");
    }
  });

  // Listen for stderr output
  this.process.stderr.on("data", function (chunk) {
    chunk = chunk.toString();
    buffer += chunk;

    // Find last line that ends with a \n
    var lineSplit = buffer.split("\n")
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

// Builds the arguments for calling curl
Connection.prototype.buildArguments = function(options) {
  var args = [];

  // Destination
  args = args.concat(["-o", this.options.destination]);

  return args;
};

// Stops the running curl process (if running)
Connection.prototype.stop = function () {
  if(this.process) {
    this.process.kill("SIGKILL");
  }
};

// Returns an error that is generated from the given string
Connection.prototype._getErrorFromString = function(string) {
  var stringSplit = string.split("\n");

  // Check for "Warning:" string
  var warning = "";
  stringSplit.forEach(function (line) {
    var match;
    if (match = line.match(/Warning:\s+?(.*)/i)) {
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

module.exports = Connection;
