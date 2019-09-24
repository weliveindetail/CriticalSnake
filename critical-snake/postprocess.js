// Determine whether the given predicate succeeds for any of our items.
if (!Set.prototype.some) {
  Set.prototype.some = function() {
    const predicate = Array.prototype.slice.call(arguments)[0];
    for (const item of this.values())
      if (predicate(item))
        return true;
    return false;
  };
}

// Determine whether any of our items is in any of the given sets.
if (!Set.prototype.overlap) {
  Set.prototype.overlap = function() {
    let args = Array.prototype.slice.call(arguments);
    return this.some(item => args.some(arg => arg.has(item)));
  };
}

// Add the values of all given sets to the current set.
if (!Set.prototype.merge) {
  Set.prototype.merge = function() {
    let args = Array.prototype.slice.call(arguments);
    for (arg of args)
      arg.forEach(id => this.add(id));
  };
}

function postprocess(datasetArray, coordFilter) {
  const unaryEach = (operator, arrays) => {
    console.assert(arrays.length == 1);
    let out = [];
    for (const item of arrays[0])
      out.push(operator(item));
    return out;
  };

  const binaryEach = (operator, arrays) => {
    console.assert(arrays.length == 2);
    console.assert(arrays[0].length == arrays[1].length);
    let out = [];
    const items = arrays[0].length;
    for (let i = 0; i < items; i++) {
      out.push(operator(arrays[0][i], arrays[1][i]));
    }
    return out;
  };

  const naryEach = (operator, arrays) => {
    console.assert(arrays.length > 0);
    //console.assert(isCommutative(operator, arrays));
    const items = arrays[0].length;
    let out = [];
    for (let i = 0; i < items; i++) {
      let x = arrays[0][i];
      for (let a = 1; a < arrays.length; a++) {
        console.assert(arrays[a].length == items);
        x = operator(x, arrays[a][i]);
      }
      out.push(x);
    }
    console.assert(out.length == items);
    return out;
  };

  const minEach = (As, Bs) => naryEach(Math.min, [As, Bs]);
  const maxEach = (As, Bs) => naryEach(Math.max, [As, Bs]);
  const plusEach = (As, Bs) => binaryEach((a, b) => a + b, [As, Bs]);
  const halfEach = (As) => unaryEach((a) => a / 2, [As]);

  const initialCoordBounds = () => {
    return {
      min: [90.0, 180.0],
      max: [-90.0, -180.0],
      center: []
    };
  };

  console.log("Initial size:", JSON.stringify(datasetArray).length);

  let postprocessedData = {
    frames: [],
    origin: null,
    snakeBounds: initialCoordBounds(),
    participantBounds: initialCoordBounds()
  };

  // Use simple integers as IDs (much less memory than hashes)
  let nextLocId = 0;
  let knownLocationIds = {};
  const hashToId = (hash) => {
    if (!knownLocationIds.hasOwnProperty(hash)) {
      knownLocationIds[hash] = nextLocId++;
    }
    return knownLocationIds[hash];
  };

  // one timestamp per frame = max stamp of all locations
  for (let dataset of datasetArray) {
    let frame = { locations: {}, timestamp: 0 };
    for (const hash in dataset.locations) {
      let loc = dataset.locations[hash];
      let locArray = [ toFloat(loc.latitude), toFloat(loc.longitude) ];
      if (coordFilter(locArray)) {
        frame.timestamp = Math.max(frame.timestamp, loc.timestamp);
        frame.locations[hashToId(hash)] = {
          coord: locArray,
          snake: null // grey
        };
      }
    }
    postprocessedData.frames.push(frame);
  }

  // Radial distance
  const sq = (x) => Math.pow(x, 2);
  const inGroupDistance = (A, B) => {
    return sq(A[0] - B[0]) + sq(A[1] - B[1]) < sq(0.0025);
  };

  // Detect snakes: >16 locations within range
  let participants = [];
  for (let frame of postprocessedData.frames) {
    // Detect groups: check distance each to each
    let groups = [];
    for (const originId in frame.locations) {
      const originCoord = frame.locations[originId].coord;
      let group = new Set();

      for (const candidateId in frame.locations) {
        const candidateCoord = frame.locations[candidateId].coord;
        if (inGroupDistance(originCoord, candidateCoord)) {
          group.add(candidateId);
        }
      }

      if (group.size > 1) {
        groups.push(group);
      }
    }

    // Merge groups with common participants
    for (let g = 0; g < groups.length; g++) {
      for (let s = g + 1; s < groups.length; s++) {
        if (groups[g].overlap(groups[s])) {
          groups[s].merge(groups[g]);
          break;
        }
      }
    }

    // Snakes are the biggest disjunct groups
    let snakes = [];
    groups.sort((a, b) => { return b.size - a.size; });

    for (const group of groups) {
      if (group.size > 15 && !group.overlap(...snakes)) {
        snakes.push(group);
      }
    }

    //console.log(snakes);

    // Add participants of snakes with >=16 locations
    let bounds = postprocessedData.snakeBounds;
    let accumulatedOrigin = [ 0, 0 ];
    for (let i = 0; i < snakes.length; i++) {
      snakes[i].forEach(id => {
        frame.locations[id].snake = i;

        let coord = frame.locations[id].coord;
        bounds.min = minEach(bounds.min, coord);
        bounds.max = maxEach(bounds.max, coord);

        if (!postprocessedData.origin) {
          accumulatedOrigin[0] += +coord[0];
          accumulatedOrigin[1] += +coord[1];
        }

        if (participants.hasOwnProperty(id)) {
          let p = participants[id];
          p.minSnakeStamp = Math.min(p.minSnakeStamp, frame.timestamp);
          p.maxSnakeStamp = Math.max(p.maxSnakeStamp, frame.timestamp);
        }
        else {
          participants[id] = {
            maxSnakeStamp: 0,
            minSnakeStamp: 8640000000000000
          };
        }
      });

      if (!postprocessedData.origin) {
        //postprocessedData.origin = halfEach(plusEach(bounds.max, bounds.min));
        postprocessedData.origin = [
          accumulatedOrigin[0] / snakes[i].size,
          accumulatedOrigin[1] / snakes[i].size
        ];
      }
    }
  }

  let deleteCount = 0;
  const dropLocation = (frame, id) => {
    delete frame.locations[id];
    deleteCount++;
  };

  let bounds = postprocessedData.participantBounds;
  for (let frame of postprocessedData.frames) {
    for (let id in frame.locations) {
      if (!participants.hasOwnProperty(id)) {
        dropLocation(frame, id);
        continue;
      }

      // Show before, during and 5min after participation
      if (participants[id].maxSnakeStamp + 300 < frame.timestamp) {
        dropLocation(frame, id);
        continue;
      }

      let coord = frame.locations[id].coord;
      bounds.min = minEach(bounds.min, coord);
      bounds.max = maxEach(bounds.max, coord);
    }
  }

  let pb = postprocessedData.participantBounds;
  pb.center = halfEach(plusEach(pb.max, pb.min));

  let sb = postprocessedData.snakeBounds;
  sb.center = halfEach(plusEach(sb.max, sb.min));

  console.log("Deleted", deleteCount, "locations");
  console.log("Postprocessed size:", JSON.stringify(postprocessedData).length);
  return postprocessedData;
}
