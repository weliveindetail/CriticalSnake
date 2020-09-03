(function(CriticalSnake) {

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

CriticalSnake.PostProcessor = function(options) {

  const self = this;

  function importApiVersion2DataPoint(dataPoint) {
    const floatCoord = (oldFormat) => {
      let chars = oldFormat.toString().split('');
      chars.splice(-6, 0, '.');
      return parseFloat(chars.join(''));
    };
    return {
      stamp: new Date(dataPoint.timestamp * 1000),
      lat: floatCoord(dataPoint.latitude),
      lng: floatCoord(dataPoint.longitude)
    };
  }

  function splitTrack(vector) {
    if (vector.duration > options.splitTrack.gapDuration) {
      return true;
    }
    if (vector.distance > options.splitTrack.gapDistance) {
      return true;
    }
    return false;
  }

  // Use simple integers as track IDs.
  function hashToIdx(hash) {
    if (!self.indexMap.hasOwnProperty(hash)) {
      // For split-tracks we can have multiple indexes for one participant.
      self.indexMap[hash] = [ self.nextIndex++ ];
    }
    // Latest track-index for the participant.
    return back(self.indexMap[hash]);
  }

  function newIdxForHash(hash) {
    if (!self.indexMap.hasOwnProperty(hash)) {
      console.error("Invalid use of newIdxForHash()");
    }
    self.indexMap[hash].push(self.nextIndex++);
    return back(self.indexMap[hash]);
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

  // The vector is the transition info between the last and the current
  // data-point in the track.
  function calculateVector(participant, dataPoint) {
    if (!options.coordFilter([ dataPoint.lat, dataPoint.lng ])) {
      self.filteredOutOfRange += 1;
      return null;
    }

    const idx = hashToIdx(participant);
    if (self.tracks.length <= idx) {
      self.tracks[idx] = [ dataPoint ];
      return null;
    }

    const latest = back(self.tracks[idx]);
    if (latest.stamp == dataPoint.stamp) {
      self.filteredDupes += 1;
      return null;
    }

    // TODO: We should record a min/max timestamp here.
    if (latest.lat == dataPoint.lat && latest.lng == dataPoint.lng) {
      self.filteredDupes += 1;
      return null;
    }

    if (latest.stamp > dataPoint.stamp) {
      console.error("Invalid dataset ordering: timestamp", latest.stamp,
                    "> timestamp", dataPoint.stamp);
      return null;
    }

    const radians = directionAngleRadians(latest, dataPoint);
    if (radians < 0 || radians > 2 * Math.PI || isNaN(radians)) {
      console.warn("Dropping data-point due to invalid direction",
                  radians, " (radians) from", latest, "to", dataPoint);
      return null;
    }

    const meters = haversineMeters(latest, dataPoint);
    if (meters <= 0) {
      console.warn("Dropping data-point due to invalid distance",
                  meters, "(meters) from", latest, "to", dataPoint);
      return null;
    }

    const seconds = (dataPoint.stamp - latest.stamp) / 1000;
    if (seconds < 0) {
      console.warn("Dropping data-point due to invalid duration",
                  seconds, " (seconds) from", latest, "to", dataPoint);
      return null;
    }

    return {
      direction: radians,
      distance: meters,
      duration: seconds
    }
  }

  this.run = (dataset) => {

    // Dataset pass: populate tracks
    for (const snapshot in dataset) {
      for (const participant in dataset[snapshot]) {
        const dataPoint = importApiVersion2DataPoint(dataset[snapshot][participant]);
        const vector = calculateVector(participant, dataPoint);

        if (vector) {
          if (splitTrack(vector)) {
            // Drop the vector and create a new track for this data-point.
            const idx = newIdxForHash(participant);
            self.tracks[idx] = [ dataPoint ];
          }
          else {
            // Add vector to the latest data-point in the track and push the new
            // data-point on top.
            const idx = hashToIdx(participant);
            back(self.tracks[idx]).vector = vector;
            self.tracks[idx].push(dataPoint);
          }
        }
      }
    }

    return {
      origin: [52.5, 13.4],
      snakeBounds: initialCoordBounds(),
      frames: [{
        coord: [52.51, 13.41],
        snake: null
      }]
    };
  }; // CriticalSnake.PostProcessor.run()

  this.tracks = [];
  this.indexMap = {};
  this.nextIndex = 0;
  this.filteredDupes = 0;
  this.filteredOutOfRange = 0;

}; // CriticalSnake.PostProcessor

})(window.CriticalSnake = window.CriticalSnake || {});
