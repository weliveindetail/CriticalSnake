(function(CriticalSnake) {

function back(array) {
  return array.length > 0 ? array[array.length - 1] : null;
}

// Determine whether the given predicate applies to any of our items.
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
    const stamp = new Date(dataPoint.timestamp * 1000);
    return {
      first_stamp: stamp,
      last_stamp: stamp,
      lat: floatCoord(dataPoint.latitude),
      lng: floatCoord(dataPoint.longitude)
    };
  }

  function splitTrack(vector) {
    if (vector.duration > options.trackRestrictions.maxGapDuration) {
      return true;
    }
    if (vector.distance > options.trackRestrictions.maxGapDistance) {
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
    const Δlon = c1.lng - c2.lng;
    return (Math.atan2(Δlon, Δφ) + 2 * Math.PI) % (2 * Math.PI);
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
  function calculateVector(latest, next) {
    if (latest.last_stamp > next.first_stamp) {
      console.error("Invalid dataset ordering: timestamp", latest.last_stamp,
                    "> timestamp", next.first_stamp);
      return null;
    }

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

    const ms = next.first_stamp - latest.last_stamp;
    if (ms < 0) {
      console.warn("Dropping data-point due to invalid duration",
                   ms * 1000, " (seconds) from", latest, "to", next);
      return null;
    }

    return {
      direction: radians,
      distance: meters,
      duration: ms
    }
  }

  function isDuplicate(latest, next) {
    if (latest.last_stamp == next.first_stamp) {
      self.filteredDupes += 1;
      return true;
    }

    // TODO: We should record a min/max timestamp here.
    if (latest.lat == next.lat && latest.lng == next.lng) {
      self.filteredDupes += 1;
      return true;
    }

    return false;
  }

  function totalDistance(track) {
    const addDists = (sum, t) => t.vector ? sum + t.vector.distance : sum;
    return track.reduce(addDists, 0);
  }

  function totalTime(track) {
    const addDurations = (sum, t) => t.vector ? sum + t.vector.duration : sum;
    return track.reduce(addDurations, 0);
  }

  this.renderTracks = (dataset) => {
    const tracks = [];

    self.indexMap = {};
    self.nextIndex = 0;
    self.filteredDupes = 0;
    self.filteredOutOfRange = 0;

    // Dataset pass: populate tracks
    for (const snapshot in dataset) {
      for (const participant in dataset[snapshot]) {
        const dataPoint = importApiVersion2DataPoint(dataset[snapshot][participant]);

        if (!options.coordFilter([ dataPoint.lat, dataPoint.lng ])) {
          self.filteredOutOfRange += 1;
          continue;
        }

        const idx = hashToIdx(participant);
        if (tracks.length <= idx) {
          tracks[idx] = [ dataPoint ];
          continue;
        }

        const latest = back(tracks[idx]);
        if (isDuplicate(latest, dataPoint)) {
          // Extend the duration of ths latest data-point.
          latest.last_stamp = dataPoint.last_stamp;
          continue;
        }

        const vector = calculateVector(latest, dataPoint);
        if (vector) {
          if (splitTrack(vector)) {
            // Drop the vector and create a new track for this data-point.
            const idx = newIdxForHash(participant);
            tracks[idx] = [ dataPoint ];
          }
          else {
            // Add vector to the latest data-point in the track and push the new
            // data-point on top.
            latest.vector = vector;
            tracks[idx].push(dataPoint);
          }
        }
      }
    }

    const relevantTracks = tracks.filter(track => {
      if (track.length < options.trackRestrictions.minDataPoints)
        return false;
      if (totalDistance(track) < options.trackRestrictions.minTotalDistance)
        return false;
      if (totalTime(track) < options.trackRestrictions.minTotalDuration)
        return false;
      return true;
    });

    // Store a flat array of data-points where each
    // has a vector and knows its predecessor.
    const dataPoints = [];
    for (const track of relevantTracks) {
      for (let i = 1; i < track.length - 1; i++) {
        track[i].pred = track[i - 1];
        dataPoints.push(track[i]);
      }
    }

    // Sort the flat array by ascending timestamps.
    const compareDates = (a, b) => a.first_stamp - b.first_stamp;
    dataPoints.sort(compareDates);

    let minEpoch = 8640000000000;
    let maxEpoch = 0;
    for (const track of relevantTracks) {
      minEpoch = Math.min(minEpoch, track[0].first_stamp.getTime() / 1000);
      maxEpoch = Math.max(maxEpoch, back(track).last_stamp.getTime() / 1000);
    }

    return {
      tracks: relevantTracks,
      dataPoints: dataPoints,
      timeRange: [ new Date(minEpoch * 1000), new Date(maxEpoch * 1000)],
    };
  }; // CriticalSnake.PostProcessor.renderTracks()

  // Find the index of an element `el` (or the first smaller one) in a sorted
  // array `ar`. The given `compare_fn` takes two arguments `A` and `B` and
  // returns:
  //   * a negative number if A is less than B;
  //   * 0 if A is equal to B;
  //   * a positive number of A is greater than B.
  //
  // If there are duplicate elements in the array, the result can be the index
  // of any one of the equal elements.
  //
  function binarySearch(ar, el, compare_fn) {
    var m = 0;
    var n = ar.length - 1;
    while (m <= n) {
        var k = (n + m) >> 1;
        var cmp = compare_fn(el, ar[k]);
        if (cmp > 0) {
            m = k + 1;
        } else if(cmp < 0) {
            n = k - 1;
        } else {
            return k;
        }
    }
    return Math.min(m, ar.length - 1);
  }

  function SlidingWindow(config) {
    this.min = 0;
    this.max = 0;

    const _setRange = (min, max) => {
      this.min = Math.max(min, 0);
      this.max = Math.min(max, config.arr.length);
    };

    this.empty = function() {
      return this.max - this.min <= 0;
    };

    this.advance = function() {
      const new_min = config.find(config.arr[this.min], config.size - config.overlap);
      const new_max = config.find(config.arr[new_min], config.size);
      _setRange(new_min, new_max);
    };

    // Initial value
    _setRange(0, config.find(config.arr[0], config.size));
  }

  function sumDistanceMoved(destination, duration) {
    const dataPointsToDestination = [];
    for (let it = destination.pred; it; it = it.pred) {
      if (destination.first_stamp - it.last_stamp > duration) {
        return totalDistance(dataPointsToDestination);
      } else {
        dataPointsToDestination.push(it);
      }
    }
    return NaN;
  };

  this.detectGatheringPoints = (dataPoints) => {
    for (const dataPoint of dataPoints) {
      const dist = sumDistanceMoved(dataPoint, options.waiting.minDuration);
      if (dist < options.waiting.maxDistanceMoved) {
        dataPoint.waiting = true;
      }
    }

    const compareDates = (a, b) => a.first_stamp - b.first_stamp;

    const config = {
      arr: dataPoints,
      size: options.gathering.windowSize,
      overlap: options.gathering.windowOverlap,
      find: (base, diff) => {
        const elem = { first_stamp: new Date(base.first_stamp.getTime() + diff) };
        return binarySearch(dataPoints, elem, compareDates);
      },
    };

    let allWaitingGroups = [];
    const maxDist = options.gathering.maxPointToPointDistance;

    for (const range = new SlidingWindow(config); !range.empty(); range.advance()) {
      const groupsInWindow = [];
      for (let a = range.min; a <= range.max; a++) {
        if (dataPoints[a].waiting) {
          const waitingGroup = new Set();
          waitingGroup.add(a);

          for (let b = a + 1; b <= range.max; b++) {
            if (dataPoints[b].waiting)
              if (haversineMeters(dataPoints[a], dataPoints[b]) < maxDist)
                waitingGroup.add(b);
          }

          if (waitingGroup.size > 10)
            groupsInWindow.push(waitingGroup);
        }
      }

      if (groupsInWindow.length > 0) {
        // Merge groups with common indexes
        const emptySet = new Set();
        for (let k = 0; k < groupsInWindow.length; k++) {
          for (let s = k + 1; s < groupsInWindow.length; s++) {
            if (groupsInWindow[k].overlap(groupsInWindow[s])) {
              groupsInWindow[k].merge(groupsInWindow[s]);
              groupsInWindow[s] = emptySet;
            }
          }
        }

        allWaitingGroups.push({
          first_stamp: dataPoints[range.min].first_stamp,
          last_stamp: dataPoints[range.max].last_stamp,
          indexSets: groupsInWindow.filter(group => group.size > 0),
        });
      }
    }

    return {
      origins: allWaitingGroups.map(entry => {
        entry.groups = entry.indexSets.map(set => {
          return Array.from(set).map(i => dataPoints[i]);
        });
        return entry;
      })
    };
  }; // CriticalSnake.PostProcessor.detectGatheringPoints()

  this.detectRoutes = (dataPoints, tracks, origins) => {
    const compareDates = (a, b) => a.first_stamp - b.first_stamp;

    const config = {
      arr: dataPoints,
      size: options.route.windowSize,
      overlap: options.route.windowOverlap,
      find: (base, diff) => {
        const elem = { first_stamp: new Date(base.first_stamp.getTime() + diff) };
        return binarySearch(dataPoints, elem, compareDates);
      },
    };

    let allGroups = [];
    const maxDist = options.route.maxPointToPointDistance;
    const π_4 = Math.PI / 4;
    const π_8 = Math.PI / 8;

    for (const range = new SlidingWindow(config); !range.empty(); range.advance()) {
      // 16 segments of the circle: 0, π/8, π/4, 3π/8, π/2, ...
      const segments = Array.from(Array(16)).map(x => []);
      const wrap = (seg) => (seg + segments.length) % segments.length;

      // Assuming segments size of π/2, each direction fits into two segments.
      for (let a = range.min; a <= range.max; a++) {
        if (dataPoints[a].vector) {
          const dir = dataPoints[a].vector.direction;
          const s1 = Math.floor(dir / π_4) * 2;
          const s2 = wrap(Math.floor((dir + π_8) / π_4) * 2 - 1);
          segments[s1].push(a);
          segments[s2].push(a);
        }
      }

      const groupsInWindow = [];

      // Within each segment find groups of vectors that are close.
      // TODO: meaasure distance between lines, not points (!!)
      for (let s = 0; s < segments.length; s++) {
        const idxs = [...new Set([
            ...segments[wrap(s - 1)],
            ...segments[s],
            ...segments[wrap(s + 1)],
          ])];

        const groupsInSegment = [];
        for (let a = 0; a < idxs.length; a++) {
          const group = new Set([ a ]);
          for (let b = a + 1; b < idxs.length; b++) {
            if (haversineMeters(dataPoints[a], dataPoints[b]) < maxDist)
              group.add(b);
          }
          if (group.size > 5)
            groupsInSegment.push(group);
        }

        if (groupsInSegment.length > 0) {
          // Merge groups with common indexes
          const emptySet = new Set();
          for (let k = 0; k < groupsInSegment.length; k++) {
            for (let s = k + 1; s < groupsInSegment.length; s++) {
              if (groupsInSegment[k].overlap(groupsInSegment[s])) {
                groupsInSegment[k].merge(groupsInSegment[s]);
                groupsInSegment[s] = emptySet;
              }
            }
          }

          for (const group of groupsInSegment.filter(group => group.size > 0)) {
            groupsInWindow.push(group);
          }
        }
      }

      allGroups.push({
        first_stamp: dataPoints[range.min].first_stamp,
        last_stamp: dataPoints[range.max].last_stamp,
        groups: groupsInWindow.filter(set => set.size > 0).map(
          set => Array.from(set).map(i => dataPoints[i])
        )
      });
    }

    console.log(allGroups);

    return {
      routes: allGroups
    };
  }; // CriticalSnake.PostProcessor.detectRoutes()

  function averageLatLng(matches, dataPoints) {
    const accLat = (sum, x) => sum + dataPoints[x].lat;
    const accLng = (sum, x) => sum + dataPoints[x].lng;
    const centerLat = matches.reduce(accLat, 0) / matches.length;
    const centerLng = matches.reduce(accLng, 0) / matches.length;
    return L.latLng(centerLat, centerLng);
  }

  function averageDirectionWithWrap(matches, dataPoints) {
    const dir = (x) => dataPoints[x].vector.direction;
    const behindWrap = matches.filter(x => dir(x) < Math.PI / 4);
    const beforeWrap = matches.filter(x => dir(x) > Math.PI * 7 / 4);

    const accDir = (sum, x) => sum + dir(x);
    const straightSum = matches.reduce(accDir, 0);

    if (beforeWrap.length == 0 || behindWrap.length == 0) {
      return straightSum / matches.length;
    } else {
      // Account for wrap-around from 2Pi to 0 angles: Add difference for all
      // values behind it and apply a modulo for cases where we end up with a
      // result above 2Pi.
      const sum = straightSum + behindWrap.length * 2 * Math.PI;
      return (sum / matches.length) % (2 * Math.PI);
    }
  }

  this.detectRoutes2 = (dataPoints, tracks, origins) => {
    const latIndex = [];
    const lngIndex = [];
    const timeIndex = [];

    for (let i = 0; i < dataPoints.length; i++) {
      latIndex.push({ lat: dataPoints[i].lat, idx: i });
      lngIndex.push({ lng: dataPoints[i].lng, idx: i });
      timeIndex.push({ time: dataPoints[i].first_stamp.getTime(), idx: i });
    }

    const compareLat = (a, b) => a.lat - b.lat;
    const compareLng = (a, b) => a.lng - b.lng;
    const compareTime = (a, b) => a.time - b.time;
    const compareDir = (a, b) => {
      const diff = a.vector.direction - b.vector.direction;
      return (diff + 2 * Math.PI) % 2 * Math.PI;
    };

    latIndex.sort(compareLat);
    lngIndex.sort(compareLng);
    timeIndex.sort(compareTime);

    const circles = [];

    const findNeighbors = (p, diffLat, diffLng, diffBefore, diffAfter) => {
      // Find range limits
      const latIdxMin = binarySearch(latIndex, { lat: p.lat - diffLat }, compareLat);
      const latIdxMax = binarySearch(latIndex, { lat: p.lat + diffLat }, compareLat);
      const lngIdxMin = binarySearch(lngIndex, { lng: p.lng - diffLng }, compareLng);
      const lngIdxMax = binarySearch(lngIndex, { lng: p.lng + diffLng }, compareLng);
      const timeIdxMin = binarySearch(timeIndex, { time: p.first_stamp.getTime() + diffBefore }, compareTime);
      const timeIdxMax = binarySearch(timeIndex, { time: p.first_stamp.getTime() + diffAfter }, compareTime);

      // Collect indexes that are in all ranges
      const latRange = new Set(latIndex.slice(latIdxMin, latIdxMax + 1).map(x => x.idx));
      const lngRange = new Set(lngIndex.slice(lngIdxMin, lngIdxMax + 1).map(x => x.idx));

      const matches = [];
      for (let t = timeIdxMin; t <= timeIdxMax; t++) {
        const idx = timeIndex[t].idx;
        if (compareDir(p, dataPoints[idx]) < Math.PI / 4 && latRange.has(idx) && lngRange.has(idx)) {
          matches.push(idx);
        }
      }

      if (matches.length > 20) {
        circles.push({
          first_stamp: dataPoints[matches[0]].first_stamp,
          last_stamp: dataPoints[matches[matches.length - 1]].last_stamp,
          size: matches.length,
          center: averageLatLng(matches, dataPoints),
          direction: averageDirectionWithWrap(matches, dataPoints),
        });
      }

      return matches;
    };

    const minute = 60 * 1000;
    let neighbors = 0;
    for (let i = 0; i < dataPoints.length; i++) {
      const idxs = findNeighbors(dataPoints[i], 0.001, 0.002, -5 * minute, 10 * minute);
      dataPoints[i].neighbors = idxs;
      neighbors += idxs.length;
    }

    console.log(neighbors);

    return {
      circles: circles
    };
  }; // CriticalSnake.PostProcessor.detectRoutes2()


//    // Bake an existing circle that is in-range for location and time,
//    // or otherwise add a new one.
//    for (let i = 0; i < dataPoints.length; i++) {
//      const dataPoint = dataPoints[i];
//      let target = circles.find(c => {
//        return c.latLng.distanceTo(dataPoint) < 50 * (1 + Math.log2(c.idxs.size)) &&
//               c.ms > dataPoint.first_stamp.getTime() - 3 * 60000 &&
//               c.ms < dataPoint.last_stamp.getTime() + 10 * 60000;
//      });
//
//      if (target) {
//        console.log("catch");
//      } else {
//        target = { idxs: new Set(), latLng: L.latLng(0, 0), ms: 0 };
//        circles.push(target);
//      }
//
//      if (!target.idxs.has(i)) {
//        const N = target.idxs.size;
//        const level = (vs, v) => (N * vs + v) / (N + 1);
//        target.idxs.add(i);
//        target.ms = level(target.ms, (dataPoint.first_stamp.getTime() + dataPoint.last_stamp.getTime()) / 2);
//        target.latLng =
//            L.latLng(level(target.latLng.lat, dataPoint.lat),
//                     level(target.latLng.lng, dataPoint.lng));
//      }
//    }

  this.indexMap = {};
  this.nextIndex = 0;
  this.filteredDupes = 0;
  this.filteredOutOfRange = 0;

}; // CriticalSnake.PostProcessor

})(window.CriticalSnake = window.CriticalSnake || {});
