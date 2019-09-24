const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const lineReader = require('line-reader');

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log('Server listening at port %d', port);
});

// Static file routing
app.use(express.static(path.join(__dirname, 'public')));

let currentLine = null;
app.get('/postv2', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(currentLine);
});

function discoverDatasets(directory) {
  return fs.readdirSync(directory).reduce(function(list, file) {
    var name = path.join(directory, file);
    var isDir = fs.statSync(name).isDirectory();
    return list.concat(isDir ? discoverDatasets(name) : [name]);
  }, []);
}

function playbackTestcase(reader, playbackFPS, frameIdx, finalizer) {
  if (reader.hasNextLine()) {
    reader.nextLine(function(err, line) {
      if (err) {
        console.error('Error serving frame', frameIdx, ":", err);
      }
      else {
        console.log('Serving frame', frameIdx);
        currentLine = line;
      }
    });
    const nextFrame = () => playbackTestcase(reader, playbackFPS, frameIdx + 1, finalizer);
    setTimeout(nextFrame, 1000 / playbackFPS);
  }
  else {
    reader.close((err) => { if (err)
      console.error('Error closing reader:', err);
    });
    finalizer();
  }
}

io.on('connection', (socket) => {
  console.log('Connected!');
  socket.emit('connected');

  let selectedDatasets = [];
  socket.on('select_datasets', (datasetFilter) => {
    selectedDatasets =
      discoverDatasets("datasets").filter(path => path.includes(datasetFilter));
    socket.emit('ready');
  });

  let currentDataset = null;
  let currentDatasetIdx = -1;
  socket.on('next_testcase', (playbackFPS) => {
    if (currentDataset) {
      socket.emit('abort', 'Still serving testcase ' + currentDataset);
      console.error('Still serving testcase', currentDataset);
    }
    else if (++currentDatasetIdx < selectedDatasets.length) {
      currentDataset = selectedDatasets[currentDatasetIdx];
      console.log('Begin test');

      if (false) { // ignore preload
        let datasetArray = [];
        new Promise((resolve, reject) => {
          lineReader.eachLine(currentDataset, (line, last) => {
            datasetArray.push(line);
            if (last)
              resolve();
          })
        }).then(function (err) {
          if (err) {
            console.error('Error reading dataset', currentDataset, ":", err);
          }
          else {
            console.log(datasetArray.length, "elements");
            socket.emit('preload_testcase', {
              dataset: currentDataset,
              data: datasetArray
            });
          }
        });
      }
      else {
        socket.emit('begin_testcase', currentDataset);

        const finalizer = () => {
          console.log('End test');
          socket.emit('end_testcase', currentDataset);
          currentDataset = null;
        };

        lineReader.open(currentDataset, (err, reader) => {
          if (err)
            console.error('Error reading dataset', currentDataset, ":", err);
          playbackTestcase(reader, playbackFPS, 0, finalizer);
        });
      }
    }
    else {
      console.log('Finished!');
      socket.emit('done');
    }
  });
});
