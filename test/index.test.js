var multicurl = require("../lib/multicurl")
  , fs = require("fs")
  , should = require("should")
  , exec = require("child_process").exec;

// Create temporary directory if it doesn't exist already
before(function () {
  if(!fs.existsSync("tmp")) {
    fs.mkdirSync("tmp");
  }
});

describe("multicurl", function () {
  it("should throw an error if no destination is given", function (done) {
    try {
      var download = new multicurl("http://www.speedtestx.de/testfiles/data_1mb.test", {
        connections: 3
      });
      download.should.throw("No destination given");
      download.run();
    } catch (e) {}
    done();
  });

  describe('.getFilesize', function () {
    it('should return the filesize', function (done) {
      download = new multicurl("http://www.speedtestx.de/testfiles/data_100mb.test");
      download.getFilesize(function (err, filesize) {
        filesize.should.equal(104857600);
        done();
      });
    });

    it('should follow redirects', function (done) {
      download = new multicurl("http://filsh.net");
      download.getFilesize(function (err, filesize) {
        filesize.should.not.equal(185);
        filesize.should.not.equal(0);
        done();
      });
    });

    describe('with https', function (done) {
      it('should return the filesize', function (done) {
        download = new multicurl();
        download.getFilesize("https://assured-id-root.digicert.com/", function (err, filesize) {
          filesize.should.not.equal(0);
          done();
        });
      });
    });
  });

  describe("multicurl#getCommands", function () {
    var download;
    before(function () {
      download = new multicurl("http://www.speedtestx.de/testfiles/data_1mb.test", {
        connections: 3,
        destination: "foo/bar"
      });
    });

    it("should return the correct commands", function (done) {
      var command = download.getCommands(function (err, commands) {
        commands.length.should.equal(3);
        commands[0].should.equal("curl -o foo/bar.0 --connect-timeout 10000 -f --range 0-349524 http://www.speedtestx.de/testfiles/data_1mb.test");
        commands[1].should.equal("curl -o foo/bar.1 --connect-timeout 10000 -f --range 349525-699049 http://www.speedtestx.de/testfiles/data_1mb.test");
        commands[2].should.equal("curl -o foo/bar.2 --connect-timeout 10000 -f --range 699050-1048575 http://www.speedtestx.de/testfiles/data_1mb.test");
        done();
      });
    });
  });

  describe("when downloading a test file with 3 connections", function () {
    var download
      , filename = "tmp/test" + Math.round(Math.random() * 10000);
    before(function () {
      download = new multicurl("http://www.speedtestx.de/testfiles/data_1mb.test", {
        connections: 1,
        destination: filename
      });
      download.run();
    });

    it("should fire a filesize event", function (done) {
      download.once("filesize", function (fileSize) {
        fileSize.should.equal(1048576);
        done()
      });
    });

    it("should fire a progress event", function (done) {
      download.once("progress", function (bytesDone, bytesTotal) {
        done()
      });
    });

    it("should fire a done event when it finished downloading", function (done) {
      this.timeout(10000);
      download.once("done", function () {
        done()
      });
    });

    it("should clean up after merging the parts", function (done) {
      fs.existsSync(filename + ".0").should.be.false;
      fs.existsSync(filename + ".1").should.be.false;
      fs.existsSync(filename + ".2").should.be.false;
      done();
    });
  });

  describe("when an error happens before running curl", function () {
    var download;
    before(function () {
      download = new multicurl("http://www.speedtestx.de/thisprobablydoesntexist", {
        connections: 3,
        destination: "temp/test" + Math.round(Math.random() * 10000),
        maxRetries: 0
      });
    });

    it("should fire an error event", function (done) {
      download.on("error", function (err) {
        err.message.should.match(/^The requested URL returned/i);
        should.exist(err);
        done();
      });
      download.run();
    });
  });

  describe("when an error happens while running curl", function () {
    var download;
    before(function () {
      download = new multicurl("http://www.speedtestx.de/testfiles/data_1mb.test", {
        connections: 3,
        destination: "somethingthatdoesntexist/test" + Math.round(Math.random() * 10000),
        maxRetries: 0
      });
    });

    it("should fire an error event", function (done) {
      download.run();
      download.on("error", function (err) {
        err.message.should.match(/^Failed to create the file/i);
        should.exist(err);
        done();
      });
    });
  });

  describe("when a connection fails", function () {
    var download;
    before(function () {
      download = new multicurl("http://localhost:4444/testfile", {
        connections: 3,
        destination: "tmp/test" + Math.round(Math.random() * 10000),
        timeout: 500
      });
    });

    var testServer = require("./test-server.js")
      , retried = 0;
    it("should try to reconnect", function (done) {
      this.timeout(30000);
      download.on("retry", function (retry, connectionIndex) {
        console.log("Retrying...")
        retried++;
      });
      download.on("error", function (err) {
        retried.should.be.above(0);
        done();
      });
      download.run();
    });
  });

  describe("when stopping a download", function () {
    this.timeout(5000);

    var download;
    before(function () {
      download = new multicurl("http://www.speedtestx.de/testfiles/data_100mb.test", {
        connections: 3,
        destination: "tmp/test" + Math.round(Math.random() * 10000)
      });
    });

    it("should stop all processes", function (done) {
      setTimeout(function () {
        download.stop();

        setTimeout(function () {
          // Get the amount of curl processes running
          exec("ps aux|grep curl|grep -v grep|grep -v mocha|wc -l", function (err, stdout, stderr) {
            stdout.trim().should.equal("0");
            done();
          });
        }, 500);

      }, 3000);
      download.run();
    });
  });

  describe("followRedirects", function () {
    describe("when set to false", function () {
      it("should not follow redirects", function (done) {
        var dest = "tmp/test" + Math.round(Math.random() * 10000);
        var download = new multicurl("http://google.com", {
          destination: dest,
          followRedirects: false
        });
        download.once("done", function () {
          var data = fs.readFileSync(dest);
          data.toString().should.match(/302 Moved/i);
          done();
        });
        download.run();
      });
    });

    describe("when set to true", function () {
      it("should follow redirects", function (done) {
        var dest = "tmp/test" + Math.round(Math.random() * 10000);
        var download = new multicurl("http://google.com", {
          destination: dest,
          followRedirects: true
        });
        download.once("done", function () {
          var data = fs.readFileSync(dest);
          data.toString().should.not.match(/302 Moved/i);
          done();
        });
        download.run();
      });
    });
  });
});
