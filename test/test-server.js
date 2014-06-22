var express = require("express")
  , app = express()
  , testFileAccessed = 0
  , fileSize = 1024;

app.get("/testfile", function (req, res) {
  res.setHeader("Content-Length", fileSize);
  if(testFileAccessed === 0 || testFileAccessed === 4) {
    for(var i = 0; i < fileSize; i++) {
      res.write("0");
    }
    res.end();
  } else {
    res.status(500).end();
  };
  testFileAccessed++;
});

module.exports = app.listen(4444);
