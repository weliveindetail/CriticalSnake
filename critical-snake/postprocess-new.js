function back(array) {
  return array.length > 0 ? array[array.length - 1] : null;
}

function initialCoordBounds() {
  return {
    min: [90.0, 180.0],
    max: [-90.0, -180.0],
    center: []
  };
}

function floatCoord(oldFormat) {
  let chars = oldFormat.toString().split('');
  chars.splice(-6, 0, '.');
  return parseFloat(chars.join(''));
}

function directionAngleRadians(c1, c2) {
  const norm = (lat) => Math.tan((lat / 2) + (Math.PI / 4));
  const Δφ = Math.log(norm(c2.lat) / norm(c1.lat));
  const Δlon = Math.abs(c1.lng - c2.lng);
  return Math.atan2(Δlon, Δφ);
}

function haversineMeters(c1, c2) {
  const R = 6371e3; // metres
  const φ1 = c1.lat * Math.PI / 180; // φ, λ in radians
  const φ2 = c2.lat * Math.PI / 180;
  const Δφ = (c2.lat - c1.lat) * Math.PI / 180;
  const Δλ = (c2.lng - c1.lng) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

function timeDiffSeconds(c1, c2) {
  const ms = new Date(c2.timestamp * 1000) - new Date(c1.timestamp * 1000);
  return ms / 1000;
}

function calculateVector(latest, next) {
  const radians = directionAngleRadians(latest, next);
  if (radians < 0 || radians > 2 * Math.PI || isNaN(radians)) {
    console.warn("Dropping data-point due to invalid direction",
                 radians, " (radians) from", latest, "to", next);
    return null;
  }

  const meters = haversineMeters(latest, next);
  if (meters <= 0) {
    console.warn("Dropping data-point due to invalid distance",
                 meters, "(meters) from", latest, "to", next);
    return null;
  }

  const seconds = timeDiffSeconds(latest, next);
  if (seconds < 0) {
    console.warn("Dropping data-point due to invalid duration",
                 seconds, " (seconds) from", latest, "to", next);
    return null;
  }

  return {
    direction: radians,
    distance: meters,
    duration: seconds
  }
}

function splitTrack(vector) {
  if (vector.duration > 300) {
    return true; // No update since 5min.
  }
  if (vector.distance > 1000) {
    return true; // No update since 1km.
  }
  return false;
}

function postprocess_new(dataset, coordFilter) {
  let filteredDupes = 0;
  let filteredOutOfRange = 0;

  // Use simple integers as track IDs.
  let nextIndex = 0;
  let indexMap = {};
  const hashToIdx = (hash) => {
    if (!indexMap.hasOwnProperty(hash)) {
      // For split-tracks we can have multiple indexes for one participant.
      indexMap[hash] = [ nextIndex++ ];
    }
    // Latest track-index for the participant.
    return back(indexMap[hash]);
  };
  const newIdxForHash = (hash) => {
    if (!indexMap.hasOwnProperty(hash)) {
      console.error("Invalid use of newIdxForHash()");
    }
    indexMap[hash].push(nextIndex++);
    return back(indexMap[hash]);
  };

  // Make a tracks of data points by ID and deduplicate entries.
  const tracks = [];
  const addToTrack = (participant, dataPoint) => {
    if (!coordFilter([ dataPoint.lat, dataPoint.lng ])) {
      filteredOutOfRange += 1;
      return;
    }

    const idx = hashToIdx(participant);
    if (tracks.length <= idx) {
      tracks[idx] = [ dataPoint ];
      return;
    }

    const latest = back(tracks[idx]);
    if (latest.timestamp == dataPoint.timestamp) {
      filteredDupes += 1;
    }
    else if (latest.lat == dataPoint.lat && latest.lng == dataPoint.lng) {
      // TODO: We should record a min/max timestamp here.
      filteredDupes += 1;
    }
    else if (latest.timestamp > dataPoint.timestamp) {
      console.error("Invalid dataset ordering: timestamp", latest.timestamp,
                    "> timestamp", dataPoint.timestamp);
    }
    else {
      // The vecotr is the transition info between the last and the current data-point.
      const vector = calculateVector(latest, dataPoint);
      if (vector == null) {
        // Drop data-point.
        return;
      }

      if (splitTrack(vector)) {
        // Drop the vector and create a new track for this data-point.
        const newIdx = newIdxForHash(participant);
        tracks[newIdx] = [ dataPoint ];
      }
      else {
        // Add vector nd data-point to the current track.
        latest.vector = vector;
        tracks[idx].push(dataPoint);
      }
    }
  };

  // Dataset pass: populate tracks
  for (const snapshot in dataset) {
    for (const participant in dataset[snapshot]) {
      const dataPoint = dataset[snapshot][participant];
      addToTrack(participant, {
        timestamp: dataPoint.timestamp,
        lat: floatCoord(dataPoint.latitude),
        lng: floatCoord(dataPoint.longitude)
      });
    }
  }

//  const vectors = [];
//  const addVector = (startpoint, endpoint) => {
//    const vector = {
//      timestamp: startpoint.timestamp,
//      lat: startpoint.lat,
//      lng: startpoint.lng
//    };
//
//    vector.dir = directionAngleRadians(startpoint, endpoint);
//    if (vector.dir < 0 || vector.dir > 2 * Math.PI || isNaN(vector.dir)) {
//      console.warn("Strange direction", vector.dir, "from", startpoint,
//                   "to", endpoint);
//    }
//
//    vector.dist = haversineMeters(startpoint, endpoint);
//    if (vector.dist <= 0 || vector.dist > 1000) {
//      console.warn("Strange distance", vector.dist, "from", startpoint,
//                   "to", endpoint);
//    }
//
//    vector.dur = (new Date(endpoint.timestamp * 1000) -
//                  new Date(startpoint.timestamp * 1000)) / 1000;
//    const fiveMinutes = 300;
//    if (vector.dur < 0 || vector.dur > fiveMinutes) {
//      console.warn("Strange duration", vector.dur, "from", startpoint,
//                   "to", endpoint);
//    }
//
//    vectors.push(vector);
//  };
//
//  // Tracks pass: populate vectors
//  for (const track of tracks) {
//    for (let i = 0; i < track.length - 1; i++) {
//      addVector(track[i], track[i + 1]);
//    }
//  }

  console.log("Filtered", filteredDupes, "duplicate data points");
  console.log("Filtered", filteredOutOfRange, "data points outside area of interest");
  console.log(tracks);

  return {
    origin: [52.5, 13.4],
    snakeBounds: initialCoordBounds(),
    frames: [{
      coord: [52.51, 13.41],
      snake: null
    }],
    tracks: tracks
  };
}
