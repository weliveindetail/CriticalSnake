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

  function leafletToGeodesy(latLng) {
    return new LatLon(latLng.lat, latLng.lng);
  }

  function geodesyDistance(c1, c2) {
    return leafletToGeodesy(c1).distanceTo(leafletToGeodesy(c2));
  }

  function geodesyBearing(c1, c2) {
    return leafletToGeodesy(c1).bearingTo(leafletToGeodesy(c2));
  }

  // The vector is the transition info between the last and the current
  // data-point in the track.
  function calculateVector(latest, next) {
    if (latest.last_stamp > next.first_stamp) {
      console.error("Invalid dataset ordering: timestamp", latest.last_stamp,
                    "> timestamp", next.first_stamp);
      return null;
    }

    return {
      direction: geodesyBearing(latest, next),
      distance: geodesyDistance(latest, next),
      duration: next.first_stamp - latest.last_stamp
    }
  }

  function isDuplicate(latest, next) {
    if (latest.last_stamp == next.first_stamp)
      return true;
    if (latest.lat == next.lat && latest.lng == next.lng)
      return true;
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
          self.filteredDupes += 1;
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
      // All data-points have a vector except the last of each track. Leave
      // that one out for convencience. We can reach it via the vector of its
      // predecessor.
      for (let i = 0; i < track.length - 1; i++) {
        const dataPoint = track[i];
        dataPoint.track = track;
        dataPoint.trackIdx = i;
        dataPoint.circles = [];
        dataPoint.snake = null;
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
    for (let i = destination.trackIdx; i >= 0; i--) {
      const dataPoint = destination.track[i];
      if (destination.first_stamp - dataPoint.last_stamp > duration) {
        return totalDistance(dataPointsToDestination);
      } else {
        dataPointsToDestination.push(dataPoint);
      }
    }
    return NaN;
  };

  function averageLatLng(dataPoints, indexes) {
    indexes = indexes || Array.from(dataPoints.keys());
    const accLat = (sum, x) => sum + dataPoints[x].lat;
    const accLng = (sum, x) => sum + dataPoints[x].lng;
    const centerLat = indexes.reduce(accLat, 0) / indexes.length;
    const centerLng = indexes.reduce(accLng, 0) / indexes.length;
    return L.latLng(centerLat, centerLng);
  }


  function minFirstStamp(dataPoints, indexes) {
    indexes = indexes || Array.from(dataPoints.keys());
    const globalMaxStamp = 8640000000000;

    const stamp = (i) => dataPoints[i].first_stamp.getTime();
    const minimize = (min, i) => Math.min(min, stamp(i));
    return new Date(indexes.reduce(minimize, globalMaxStamp));
  }

  function maxLastStamp(dataPoints, indexes) {
    indexes = indexes || Array.from(dataPoints.keys());
    const globalMinStamp = 0;

    const stamp = (i) => dataPoints[i].last_stamp.getTime();
    const maximize = (max, i) => Math.max(max, stamp(i));
    return new Date(indexes.reduce(maximize, globalMinStamp));
  }

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
          const waitingGroup = [ a ];
          for (let b = a + 1; b <= range.max; b++) {
            if (dataPoints[b].waiting)
              if (haversineMeters(dataPoints[a], dataPoints[b]) < maxDist)
                waitingGroup.push(b);
          }

          if (waitingGroup.length > 10)
            groupsInWindow.push(waitingGroup);
        }
      }

      if (groupsInWindow.length > 0) {
        // Merge groups in close proximity
        const latLngs = groupsInWindow.map(group => averageLatLng(dataPoints, group));

        for (let k = 0; k < groupsInWindow.length; k++) {
          for (let s = k + 1; s < groupsInWindow.length; s++) {
            if (latLngs[k].distanceTo(latLngs[s]) < 1000) {
              groupsInWindow[s] = [...groupsInWindow[k], ...groupsInWindow[s]];
              groupsInWindow[k] = [];
              latLngs[s] = averageLatLng(dataPoints, groupsInWindow[s]);
              latLngs[k] = L.latLng(0, 0);
            }
          }
        }

        const remainingLatLngs = latLngs.filter(x => x.lat != 0 || x.lng != 0);
        //if (remainingLatLngs.length > 1) {
        //  console.log("remainingLatLngs:", remainingLatLngs,
        //              "groupsInWindow:", groupsInWindow.filter(x => x.length > 0));
        //}

        allWaitingGroups.push({
          first_stamp: dataPoints[range.min].first_stamp,
          last_stamp: dataPoints[range.max].last_stamp,
          latLngs: remainingLatLngs,
        });
      }
    }

    return {
      origins: allWaitingGroups
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
    const π_4 = 45; //Math.PI / 4;
    const π_8 = 22.5; //Math.PI / 8;

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



  function averageDirectionWithWrap(dataPoints, indexes) {
    indexes = indexes || Array.from(dataPoints.keys());

    const dir = (x) => dataPoints[x].vector.direction;
    const behindWrap = indexes.filter(x => dir(x) < 45);
    const beforeWrap = indexes.filter(x => dir(x) > 315);

    const accDir = (sum, x) => sum + dir(x);
    const straightSum = indexes.reduce(accDir, 0);

    if (beforeWrap.length == 0 || behindWrap.length == 0) {
      return straightSum / indexes.length;
    } else {
      // Account for wrap-around from 2Pi to 0 angles: Add difference for all
      // values behind it and apply a modulo for cases where we end up with a
      // result above 2Pi.
      const sum = straightSum + behindWrap.length * 360;
      return (sum / indexes.length) % 360;
    }
  }

  function interpolateLinear(c1, c2, dist) {
    const p1 = leafletToGeodesy(c1);
    const p2 = leafletToGeodesy(c2);
    const requestedSamples = Math.floor(p1.distanceTo(p2) / dist);
    const points = Array.from(Array(Math.max(2, requestedSamples)));
    const fractionIncr = 1 / (points.length - 1);
    const stampBase = c1.first_stamp.getTime();
    const stampIncr = (c2.last_stamp.getTime() - stampBase) / (points.length - 1);

    for (let i = 0, f = 0, s = stampBase; i < points.length; i++) {
      const geodesyLatLon = p1.intermediatePointTo(p2, f);
      points[i] = {
        lat: geodesyLatLon.lat,
        lng: geodesyLatLon.lon,
        first_stamp: new Date(s),
        last_stamp: new Date(s),
        vector: {
          direction: c1.vector.direction
        }
      };
      f += fractionIncr;
      s += stampIncr;
    }

    return points;
  }

  function ConvexEnvelopeSearch(data, searchFn) {
    const indexOrder = (a, b) => a.value - b.value;
    const dimensions = [];

    this.addDimension = function(config) {
      const entryForIndex = (item, i) => ({
        value: config.value(item),
        key: i
      });
      const entryForSearch = (item, tolerance) => ({
        value: config.value(item) + tolerance
      });
      dimensions.push({
        index: data.map(entryForIndex).sort(indexOrder),
        lowerBound: (item) => entryForSearch(item, config.lowerBoundTolerance),
        upperBound: (item) => entryForSearch(item, config.upperBoundTolerance),
      });
    }

    this.itemsInEnvelope = function(item) {
      const lowerBound = d => searchFn(d.index, d.lowerBound(item), indexOrder);
      const upperBound = d => searchFn(d.index, d.upperBound(item), indexOrder);

      const keySets = [];
      for (let d = 1; d < dimensions.length; d++) {
        const dim = dimensions[d];
        const first = lowerBound(dim);
        const last = upperBound(dim);
        keySets.push(new Set(dim.index.slice(first, last + 1)
                                      .map(entry => entry.key)));
      }

      const inAllKeySets = (key) => {
        for (const keySet of keySets) {
          if (!keySet.has(key))
            return false;
        }
        return true;
      };

      const primary = dimensions[0];
      const first = lowerBound(primary);
      const last = upperBound(primary);

      const matches = [];
      for (let i = first; i <= last; i++) {
        if (inAllKeySets(primary.index[i].key)) {
          matches.push(primary.index[i].key);
        }
      }

      return matches;
    }

    return this;
  }

  this.detectRoutes2 = (dataPoints, tracks, origins) => {
    const pointsInTime = ConvexEnvelopeSearch(dataPoints, binarySearch);

    const minute = 60 * 1000;

    pointsInTime.addDimension({
      lowerBoundTolerance: -5 * minute,
      upperBoundTolerance: 10 * minute,
      value: (item) => item.first_stamp.getTime(),
    });
    pointsInTime.addDimension({
      lowerBoundTolerance: -0.001,
      upperBoundTolerance: 0.001,
      value: (item) => item.lat,
    });
    pointsInTime.addDimension({
      lowerBoundTolerance: -0.002,
      upperBoundTolerance: 0.002,
      value: (item) => item.lng,
    });

    const dir = (idx) => dataPoints[idx].vector.direction;
    const dirDiff = (a, b) => (dir(a) - dir(b) + 360) % 360;

    const timeBegin = Date.now();
    const circles = [];
    for (let i = 0; i < dataPoints.length - 1; i++) {
      if (dataPoints[i].circles.length == 0) {
        const curr = dataPoints[i];
        const next = dataPoints[i].track[dataPoints[i].trackIdx + 1];

        const samplePoints = interpolateLinear(curr, next, 100);
        for (const samplePoint of samplePoints.slice(0, -1)) {
          const undirectedMatches = pointsInTime.itemsInEnvelope(samplePoint);
          const matches = undirectedMatches.filter(m => dirDiff(i, m) < 45);
          if (matches.length > 5) {
            const latLng = averageLatLng(dataPoints, matches);
            const circle = {
              first_stamp: minFirstStamp(dataPoints, matches),
              last_stamp: maxLastStamp(dataPoints, matches),
              dataPointIdxs: matches,
              lat: latLng.lat,
              lng: latLng.lng,
              vector: {
                direction: averageDirectionWithWrap(dataPoints, matches),
              },
              pathsTo: {},
              id: circles.length,
            }
            circles.push(circle);
            for (const idx of matches) {
              dataPoints[idx].circles.push(circle.id);
            }
          }
        }
      }
    }
    const timeEnd = Date.now();
    console.log("Populating circles took:", (timeEnd - timeBegin), "ms");



    //const leveledScalar = (avg, num, val) => (num * avg + val) / (num + 1);
    //const leveledStamp = (avg, num, val) => {
    //  return new Date((num * avg.getTime() + val.getTime()) / (num + 1));
    //};

    //        for (const dataPointIdx of entry.matches) {
    //          // Bake existing circles if direction is similar
    //          let circlesBaked = 0;
    //          for (const cc of dataPoints[dataPointIdx].circles.map(id => circles[id])) {
    //            if (cfg1.compareDir(sp, cc) < 45) {
    //              // Continuously balance the circle's coordinates.
    //              const n = cc.points.length;
    //              cc.lat = leveledScalar(cc.lat, n, sp.lat);
    //              cc.lng = leveledScalar(cc.lng, n, sp.lng);
    //              cc.first_stamp = leveledStamp(cc.first_stamp, n, sp.first_stamp);
    //              cc.last_stamp = leveledStamp(cc.last_stamp, n, sp.last_stamp);
    //
    //              // The sampling-point has contributed to this circle.
    //              cc.points.push(sp);
    //              circlesBaked += 1;
    //
    //              // Account for the wrap-around of the angle when balancing the
    //              // direction.
    //              const d = (p) => p.vector.direction;
    //              const straightSum = n * d(cc) + d(sp);
    //              if (d(sp) < 45 && d(cc) > 315) {
    //                cc.vector.direction = ((straightSum + 360) / (n + 1)) % 360;
    //              } else if (d(sp) > 315 && d(cc) < 45) {
    //                cc.vector.direction = ((straightSum + n * 360) / (n + 1)) % 360;
    //              } else {
    //                cc.vector.direction = straightSum / (n + 1);
    //              }
    //            }
    //          }
    //
    //          if (circlesBaked == 0) {
    //            remainingMatches.push(dataPointIdx);
    //          }
    //        }



    //        // Create new circles for matched data-points that didn't contribute to
    //        // any existing circles.
    //        for (const dataPointIdx of remainingMatches) {
    //          const rp = dataPoints[dataPointIdx];
    //          const circle = {
    //            first_stamp: new Date(Math.min(sp.first_stamp.getTime(), rp.first_stamp.getTime())),
    //            last_stamp: new Date(Math.max(sp.last_stamp.getTime(), rp.last_stamp.getTime())),
    //            points: [sp, rp],
    //            lat: (sp.lat + rp.lat) / 2,
    //            lng: (sp.lng + rp.lng) / 2,
    //            vector: {
    //              direction: averageDirectionWithWrap([sp, rp]),
    //            },
    //            pathsTo: {},
    //            id: circles.length,
    //          }
    //          rp.circles.push(circle.id);
    //          sp.circles.push(circle.id);
    //          circles.push(circle);
    //        }

//    const stampMax = 8640000000000;
//    const stampMin = 0;
//    const mergeCircles = (cs) => {
//      return {
//        first_stamp: cs.reduce((res, elem) => new Date(Math.min(res, elem.first_stamp.getTime())), stampMax),
//        last_stamp: cs.reduce((res, elem) => new Date(Math.max(res, elem.last_stamp.getTime())), stampMin),
//        dataPointIdxs: cs.reduce((all, elem) => [...all, ...elem.dataPointIdxs], []),
//        lat: cs.reduce((sum, elem) => sum + elem.lat, 0) / cs.length,
//        lng: cs.reduce((sum, elem) => sum + elem.lng, 0) / cs.length,
//        vector: {
//          direction: averageDirectionWithWrap(Object.keys(cs), cs),
//        },
//      };
//    };
//
//    for (const ids of circleIdsByDataPointIdx.filter(ids => ids.length > 1)) {
//      circles[ids[0]] = mergeCircles(ids.map(id => circles[id]));
//      for (let i = 1; i < ids; i++) {
//        circles[ids[i]] = null;
//      }
//    }

    //    // Data-point didn't make it into any circle.
    //    dataPoints[i].circle = null;
    //  } else {
    //    // Merge 
    //    for (let c = 1; c < circlesByDataPointIdx[i].length; c++) {
    //      //
    //    }
    //  }
    //}


    // Turn circles into a directed graph connected by track segments
//    let abortCount = 0;
//    for (const track of tracks) {
//      for (let t = 0; t < track.length - 1; t++) {
//        const dataPoint = track[t];
//        if (dataPoint.circles.length > 0) {
//          const min_i = Math.max(0, t - 5);
//
//          //if (dataPoint.circles.length > 50) {
//          //  console.log("Data-point", dataPoint, "is in", dataPoint.circles.length,
//          //              "circles:", dataPoint.circles.map(id => circles[id]));
//          //  abortCount += 1;
//          //  if (abortCount > 20) {
//          //    throw new Error("aborting..");
//          //  }
//          //}
//
//          // Follow the track backwards in history. Each circle we see is a
//          // predecessor of each circle the current data-point matched with.
//          for (let i = t - 1; i >= min_i; i--) {
//            const segment = track.slice(i, t);
//            for (const circleFrom of track[i].circles.map(id => circles[id])) {
//              for (const circleIdTo of dataPoint.circles) {
//                if (circleFrom.pathsTo.hasOwnProperty(circleIdTo)) {
//                  circleFrom.pathsTo[circleIdTo].push(segment);
//                }
//                else {
//                  circleFrom.pathsTo[circleIdTo] = [ segment ];
//                }
//              }
//            }
//          }
//        }
//      }
//    }

    const snakeOrigins = [];
    const startTime = 1598638200000; // 20:10
    const atStartTime = (stamp) => {
      return stamp.first_stamp.getTime() < startTime && stamp.last_stamp.getTime() > startTime;
    };
    const overlaps = (circle, snake) => {
      return snake.some(s => geodesyDistance(circle, s) < 1000);
    };
    const addToSnake = (circle) => {
      const snake = snakeOrigins.find(s => overlaps(circle, s));
      if (snake) {
        snake.push(circle);
      }
      else {
        snakeOrigins.push([ circle ]);
      }
    };

    for (const circle of circles.filter(x => atStartTime(x))) {
      addToSnake(circle);
    }

    snakeOrigins.sort((a, b) => b.length - a.length);
    snakeOrigins.map((snake, snakeId) => {
      for (const circle of snake) {
        //circle.snake = snakeId;
        for (const idx of circle.dataPointIdxs) {
          const p = dataPoints[idx];
          const restOfTrack = p.track.slice(p.trackIdx, -1);
          for (const dataPoint of restOfTrack) {
            dataPoint.snake = snakeId;
            for (const c of dataPoint.circles) {
              //if (circles[c].snake && circles[c].snake != snakeId) {
              //  console.log("Circle is in multiple snakes:", circles[c].snake, snakeId);
              //}
              circles[c].snake = snakeId;
            }
          }
        }
      }
    });

    const calcWeight = (paths) => {
      return paths.reduce((sum, elem) => sum + 1 / elem.length, 0);
    };

    const mergeTargetPathsForBlob = (blob) => {
      const allPaths = {};
      for (const circle of blob) {
        for (const targetId in circle.pathsTo) {
          if (allPaths.hasOwnProperty(targetId)) {
            for (const path of circle.pathsTo[targetId])
              allPaths[targetId].paths.push(path);
          }
          else {
            allPaths[targetId] = {
              id: targetId,
              paths: circle.pathsTo[targetId]
            };
          }
        }
      }
      return allPaths;
    };

    const calculateCircleClusters = (circleIds) => {
      const totalIds = circleIds.length;
      const clusters = circleIds.map(id => ({
        ids: [ id ],
        latLng: L.latLng(circles[id].lat, circles[id].lng),
      }));
      const clusterDist = (i, j) => {
        if (clusters[i] && clusters[j])
          return geodesyDistance(clusters[i].latLng, clusters[j].latLng);
        else
          console.log(clusters[i], clusters[j]);
      };
      const countIds = (sum, cluster) => sum + cluster.ids.length;
      const largestGroups = (n) => {
        clusters.sort((a, b) => b.ids.length - a.ids.length);
        return clusters.slice(0, n);
      };

      // Cluster until 80% of IDs are in 3 largest groups.
      while (largestGroups(3).reduce(countIds, 0) < totalIds * 0.8) {
        //console.log("From", clusters.length, "clusters, the top 3 have",
        //            largestGroups(3).reduce(countIds, 0), "elements");
        let minDist = 10000;
        let min_i = -1;
        let min_j = -1;
        for (let i = 0; i < clusters.length; i++) {
          for (let j = i + 1; j < clusters.length; j++) {
            const dist = clusterDist(i, j);
            if (dist < minDist) {
              [ minDist, min_i, min_j ] = [ dist, i, j];
            }
          }
        }

        clusters[min_i].ids = clusters[min_i].ids.concat(clusters[min_j].ids);
        clusters[min_i].latLng = averageLatLng(circles, clusters[min_i].ids);
        clusters.splice(min_j, 1);
      }

      return clusters;
    };


//    let i = 0;
//    let blobs = [ ...snakeOrigins ];
//
//    while (i < blobs.length) {
//      const allPaths = mergeTargetPathsForBlob(blobs[i]);
//      const targetClusters = calculateCircleClusters(Object.keys(allPaths));
//
//      if (targetClusters.length > 0) {
//        blobs.push(targetClusters[0]);
//        for (let k = 1; k < targetClusters.length; k++) {
//          if (targetClusters[k].length < targetClusters[0].length * 0.5)
//            break;
//          blobs.push(targetClusters[k].ids.map(id => circle[id]));
//        }
//      }
//
//      //const weighedPaths = Object.values(allPaths).sort((a, b) => {
//      //  return calcWeight(b.paths) - calcWeight(a.paths);
//      //});
//      //const topPaths = weighedPaths.slice(0, weighedPaths.length / 3);
//      //const topIds = topPaths.reduce((topIds, path) => {
//      //  return topIds.push(path.id);
//      // }, []);
//
//      console.log(targetClusters);
//      i++;
//    }


//        for (const prevCircleId in dataPointsSince) {
//          if (dataPointsSince[prevCircleId].length > 5) {
//            delete dataPointsSince[prevCircleId];
//          } else {
//            dataPointsSince[prevCircleId].push(dataPoint);
//          }
//        }
//
//        for (const currCircle of dataPoint.circles) {
//          dataPointsSince[currCircle.id] = [];
//          for (const prevCircleId in dataPointsSince) {
//            const path = dataPointsSince[prevCircleId];
//            if (path.length > 0) {
//              if (currCircle.pathsFrom.hasOwnProperty(prevCircleId)) {
//                currCircle.pathsFrom[prevCircleId].push(path);
//              }
//              else {
//                currCircle.pathsFrom[prevCircleId] = [ path ];
//              }
//            }
//          }
//        }
//      }

    return {
      //circles: tracks[0][206].circles.map(x => circles[x])
      circles: circles,
      snakes: snakeOrigins, //.map((_, idx) => colors[idx])
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
