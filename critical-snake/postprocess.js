(function(CriticalSnake, L, LatLon) {

if (typeof(L) != "object")
  return CriticalSnake.missingDependency("Leaflet");
if (typeof(LatLon) != "function")
  return CriticalSnake.missingDependency("Geodesy spherical functions");

// Make options accessible from the browser's debug console. The actual options
// are populated when creating a CriticalSnake.PostProcessor().
CriticalSnake.PostProcessOptions = {};

// Incoming keys take precedence.
CriticalSnake.overridePostprocessOptions = function(incoming) {
  CriticalSnake.PostProcessOptions =
      CriticalSnake.mergeOptions(CriticalSnake.PostProcessOptions, incoming);
};

// Existing keys take precedence.
CriticalSnake.populatePostprocessOptions = function(incoming) {
  CriticalSnake.PostProcessOptions =
      CriticalSnake.mergeOptions(incoming, CriticalSnake.PostProcessOptions);
};

CriticalSnake.FilterBounds = {
  Aschaffenburg: L.latLngBounds([49.85, 8.92],[50.07, 9.29]),
  Augsburg: L.latLngBounds([48.24, 10.60],[48.49, 11.13]),
  Bayreuth: L.latLngBounds([49.83, 11.40],[50.02, 11.75]),
  Berlin: L.latLngBounds([52.42, 13.21], [52.61, 13.58]),
  Barcelona: L.latLngBounds([41.26, 2.00], [41.45, 2.29]),
  Hof: L.latLngBounds([50.24, 11.78],[50.38, 12.04]),
  Leipzig: L.latLngBounds([51.29, 12.29], [51.37, 12.45]),
  München: L.latLngBounds([47.83, 10.77],[48.46, 12.29]),
  München_zoomed: L.latLngBounds([46.83, 09.77],[49.46, 13.29]),
  München_Augsburg: L.latLngBounds([47.97, 10.52],[48.50, 12.14]),
  Mainz: L.latLngBounds([49.90, 8.11], [50.10, 8.40]),
  Nürnberg: L.latLngBounds([49.34, 10.88],[49.55, 11.27]),
};

CriticalSnake.PostProcessor = function() {

  function importApiVersion2DataPoint(dataPoint) {
    const floatCoord = (oldFormat) => {
      const sign = oldFormat < 0 ? -1 : 1;
      const chars = Math.abs(oldFormat).toString().padStart(6, '0').split('');
      chars.splice(-6, 0, '.');
      return sign * parseFloat(chars.join(''));
    };
    return {
      first_stamp: dataPoint.timestamp * 1000,
      last_stamp: dataPoint.timestamp * 1000,
      lat: floatCoord(dataPoint.latitude),
      lng: floatCoord(dataPoint.longitude),
    };
  }

  function back(array) {
    return array.length > 0 ? array[array.length - 1] : null;
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

  CriticalSnake.populatePostprocessOptions({
    loadRawTracks: {}
  });

  this.loadRawTracks = function(dataset) {
    const opts = CriticalSnake.PostProcessOptions.loadRawTracks;

    const indexMap = {};
    let nextIndex = 0;
    const hashToTrackIdx = (hash) => {
      if (!indexMap.hasOwnProperty(hash)) {
        indexMap[hash] = nextIndex++;
      }
      return indexMap[hash];
    };

    const pool = [];
    const tracks = [];
    let minStamp = 8640000000000000;
    let maxStamp = 0;

    for (const snapshot in dataset) {
      for (const participant in dataset[snapshot]) {
        const dataPoint = importApiVersion2DataPoint(dataset[snapshot][participant]);
        if (dataPoint.lat == 0 && dataPoint.lng == 0)
          continue;

        const dataPointIdx = pool.push(dataPoint) - 1;
        const trackIdx = hashToTrackIdx(participant);
        if (trackIdx >= tracks.length) {
          tracks.push([ dataPointIdx ]);
        } else {
          tracks[trackIdx].push(dataPointIdx);
        }

        minStamp = Math.min(minStamp, dataPoint.first_stamp);
        maxStamp = Math.max(maxStamp, dataPoint.last_stamp);
      }
    }

    const timeRange = { begin: new Date(minStamp), end: new Date(maxStamp) };
    return [pool, tracks, timeRange];
  }

  function isDuplicate(latest, next) {
    if (latest.last_stamp == next.last_stamp)
      return true;
    if (latest.lat == next.lat && latest.lng == next.lng)
      return true;
    return false;
  }

  function createCoordFilterFromBounds(latLngBounds) {
    function NumericRange(min, max) {
      this.contains = (val) => min < val && max > val;
      return this;
    }
    const latRange = new NumericRange(latLngBounds.getSouth(),
                                      latLngBounds.getNorth());
    const lngRange = new NumericRange(latLngBounds.getWest(),
                                      latLngBounds.getEast());
    return (x) => !latRange.contains(x.lat) || !lngRange.contains(x.lng);
  }

  function isRelevantTrack(dataPoints, trackIdxs, options) {
    if (trackIdxs.length < options.minDataPoints)
      return false;

    const firstStamp = dataPoints[trackIdxs[0]].first_stamp;
    const lastStamp = dataPoints[back(trackIdxs)].last_stamp;
    if (lastStamp - firstStamp < options.minDuration)
      return false;

    let totalDistance = 0;
    for (let i = 0; i < trackIdxs.length - 1; i++) {
      const fromIdx = trackIdxs[i];
      const toIdx = trackIdxs[i + 1];
      totalDistance += geodesyDistance(dataPoints[fromIdx], dataPoints[toIdx]);

      if (totalDistance > options.minDistance)
        return true;
    }

    return false;
  }

  function splitTrack(latest, next, options) {
    if (next.first_stamp - latest.last_stamp > options.maxGapDuration) {
      return true;
    }
    if (geodesyDistance(latest, next) > options.maxGapDistance) {
      return true;
    }
    return false;
  }

  function reindexTracks(pool, perTrackPoolIdxs) {
    // Indexes into the pool for all our tracks, sorted by ascending timestamps.
    const sortedPoolIdxs = perTrackPoolIdxs.flat();
    sortedPoolIdxs.sort((a, b) => pool[a].first_stamp - pool[b].first_stamp);

    // A translation of indexes from the original ordering in the pool (oldIdx)
    // to the new ordering by ascending timestamps (newIdx).
    const lookup = Array.from(Array(sortedPoolIdxs.length)).fill(-1);
    for (let newIdx = 0; newIdx < sortedPoolIdxs.length; newIdx++) {
      const oldIdx = sortedPoolIdxs[newIdx];
      lookup[oldIdx] = newIdx;
    }

    // The reindexed pool is what we call "dataPoints" from now on.
    const dataPoints = sortedPoolIdxs.map(newIdx => pool[newIdx]);

    // A track is an array of indexes into dataPoints. Each dataPoint has a
    // nextIdxInTrack that points to the next dataPoint in the track or
    // indicates the end of the track (null).
    const tracks = perTrackPoolIdxs.map((oldTrackIdxs, t) => {
      const newTrackIdxs = [ lookup[oldTrackIdxs[0]] ];
      for (let i = 1; i < oldTrackIdxs.length; i++) {
        const oldIdx = oldTrackIdxs[i];
        const newIdx = lookup[oldIdx];

        const predInTrack = dataPoints[back(newTrackIdxs)];
        predInTrack.direction = geodesyBearing(predInTrack, dataPoints[newIdx]);
        predInTrack.nextIdxInTrack = newIdx;
        predInTrack.trackIdx = t;

        newTrackIdxs.push(newIdx);
      }
      dataPoints[back(newTrackIdxs)].nextIdxInTrack = null;
      dataPoints[back(newTrackIdxs)].trackIdx = t;
      return newTrackIdxs;
    });

    return [ tracks, dataPoints ];
  }

  CriticalSnake.populatePostprocessOptions({
    analyzeTracks: {
      startStamp: 0,
      endStamp: 8640000000000000,
      filterName: "Berlin",
      trackFilter: {
        minDataPoints: 8,
        minDistance: 1000,
        minDuration: 5 * 60 * 1000,
      },
      splitConditions : {
        maxGapDuration: 5 * 60 * 1000,
        maxGapDistance: 1000,
      },
    }
  });

  this.analyzeTracks = function(dataset) {
    const opts = CriticalSnake.PostProcessOptions.analyzeTracks;

    const indexMap = {};
    let nextIndex = 0;

    // Use simple integers as track IDs.
    const hashToIdx = (hash) => {
      if (!indexMap.hasOwnProperty(hash)) {
        indexMap[hash] = [ nextIndex++ ];
      }
      // Latest track-index for the participant.
      return back(indexMap[hash]);
    };

    // For split-tracks we can have multiple indexes per participant.
    const newIdxForHash = (hash) => {
      if (!indexMap.hasOwnProperty(hash)) {
        console.error("Invalid use of newIdxForHash()");
      }
      indexMap[hash].push(nextIndex++);
      return back(indexMap[hash]);
    }

    let filteredDupes = 0;
    let filteredCoordOutOfBounds = 0;
    let filteredTimeOutOfBounds = 0;

    const pool = [];
    const perTrackPoolIdxs = [];
    const filterBounds = CriticalSnake.FilterBounds[opts.filterName];
    const filterCoord = createCoordFilterFromBounds(filterBounds);

    const filterTime = (dataPoint) => {
      return dataPoint.first_stamp < opts.startStamp ||
             dataPoint.last_stamp > opts.endStamp;
    };

    for (const snapshot in dataset) {
      for (const participant in dataset[snapshot]) {
        const dataPoint = importApiVersion2DataPoint(dataset[snapshot][participant]);

        if (filterCoord(dataPoint)) {
          filteredCoordOutOfBounds += 1;
          continue;
        }

        if (filterTime(dataPoint)) {
          filteredTimeOutOfBounds += 1;
          continue;
        }

        dataPoint.trackIdx = hashToIdx(participant);
        if (perTrackPoolIdxs.length <= dataPoint.trackIdx) {
          perTrackPoolIdxs[dataPoint.trackIdx] = [ pool.length ];
          pool.push(dataPoint);
          continue;
        }

        const latest = pool[back(perTrackPoolIdxs[dataPoint.trackIdx])];
        if (isDuplicate(latest, dataPoint)) {
          // Extend the duration of the latest data-point. Don't add the
          // current data-point to the pool.
          latest.last_stamp = dataPoint.last_stamp;
          filteredDupes += 1;
          continue;
        }

        if (splitTrack(latest, dataPoint, opts.splitConditions)) {
          // Create a new track starting with this data-point.
          dataPoint.trackIdx = newIdxForHash(participant);
          perTrackPoolIdxs[dataPoint.trackIdx] = [ pool.length ];
          pool.push(dataPoint);
        }
        else {
          // Add the dataPoint to the track and the pool.
          perTrackPoolIdxs[dataPoint.trackIdx].push(pool.length);
          pool.push(dataPoint);
        }
      }
    }

    const trackFilter = (idxs) => isRelevantTrack(pool, idxs, opts.trackFilter);
    const relevantTracks = perTrackPoolIdxs.filter(trackFilter);
    relevantTracks.sort((trackA, trackB) => trackB.length - trackA.length);

    const filteredIrrelTracks = perTrackPoolIdxs.flat().length -
                                relevantTracks.flat().length;

    console.log("Filtered", filteredDupes, "duplicate data points");
    console.log("Filtered", filteredCoordOutOfBounds, "data points outside area of interest");
    console.log("Filtered", filteredTimeOutOfBounds, "data points outside time-range");
    console.log("Filtered", filteredIrrelTracks, "data points from irrelevant tracks");

    return reindexTracks(pool, relevantTracks);
  };
  // CriticalSnake.PostProcessor.analyzeTracks()

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

  function averageLatLng(dataPoints, indexes) {
    indexes = indexes || Array.from(dataPoints.keys());
    const accLat = (sum, x) => sum + dataPoints[x].lat;
    const accLng = (sum, x) => sum + dataPoints[x].lng;
    const centerLat = indexes.reduce(accLat, 0) / indexes.length;
    const centerLng = indexes.reduce(accLng, 0) / indexes.length;
    return L.latLng(centerLat, centerLng);
  }

  function averageFirstStamp(dataPoints, indexes) {
    indexes = indexes || Array.from(dataPoints.keys());
    const accStamp = (sum, x) => sum + dataPoints[x].first_stamp;
    return indexes.reduce(accStamp, 0) / indexes.length;
  }

  function minFirstStamp(dataPoints, indexes) {
    indexes = indexes || Array.from(dataPoints.keys());
    const globalMaxStamp = 8640000000000;

    const stamp = (i) => dataPoints[i].first_stamp;
    const minimize = (min, i) => Math.min(min, stamp(i));
    return indexes.reduce(minimize, globalMaxStamp);
  }

  function maxLastStamp(dataPoints, indexes) {
    indexes = indexes || Array.from(dataPoints.keys());
    const globalMinStamp = 0;

    const stamp = (i) => dataPoints[i].last_stamp;
    const maximize = (max, i) => Math.max(max, stamp(i));
    return indexes.reduce(maximize, globalMinStamp);
  }

  function averageDirectionWithWrap(dataPoints, indexes) {
    indexes = indexes || Array.from(dataPoints.keys());

    const dir = (x) => dataPoints[x].direction;
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
    const stampBase = c1.first_stamp;
    const stampIncr = (c2.last_stamp - stampBase) / (points.length - 1);

    for (let i = 0, f = 0, s = stampBase; i < points.length; i++) {
      const geodesyLatLon = p1.intermediatePointTo(p2, f);
      points[i] = {
        lat: geodesyLatLon.lat,
        lng: geodesyLatLon.lon,
        first_stamp: s,
        last_stamp: s,
        direction: c1.direction
      };
      f += fractionIncr;
      s += stampIncr;
    }

    return points;
  }

  function findSamplePoints(dataPoints, idx, options) {
    const nextIdx = dataPoints[idx].nextIdxInTrack;
    if (nextIdx == null)
      return [ dataPoints[idx] ];

    const range = interpolateLinear(dataPoints[idx], dataPoints[nextIdx],
                                    options.samplePointDist);

    // Drop the destination point in order to avoid double sampling.
    return range.slice(0, -1);
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

  function createCircle(latLng, matches, circles, dataPoints) {
    const circle = {
      lat: latLng.lat,
      lng: latLng.lng,
      first_stamp: minFirstStamp(dataPoints, matches),
      last_stamp: maxLastStamp(dataPoints, matches),
      direction: averageDirectionWithWrap(dataPoints, matches),
      dataPointIdxs: matches,
      idx: circles.length,
    }
    circles.push(circle);
    return circle;
  }

  function joinCircle(circleToJoin, matches, dataPoints) {
    const indexes = circleToJoin.dataPointIdxs.concat(matches);
    const latLng = averageLatLng(dataPoints, indexes);
    circleToJoin.lat = latLng.lat;
    circleToJoin.lng = latLng.lng;
    circleToJoin.first_stamp = minFirstStamp(dataPoints, indexes);
    circleToJoin.last_stamp = maxLastStamp(dataPoints, indexes);
    circleToJoin.direction = averageDirectionWithWrap(dataPoints, indexes);
    circleToJoin.dataPointIdxs = indexes;
    return circleToJoin;
  }

  function createOrJoinCircle(matches, circles, dataPoints, options) {
    const latLng = averageLatLng(dataPoints, matches);
    const stamp = averageFirstStamp(dataPoints, matches);
    const inTime = (c) => {
      return c.first_stamp - stamp > -options.tolerance.timeBefore &&
             c.last_stamp - stamp < options.tolerance.timeAfter
    };

    for (const circle of circles.filter(inTime)) {
      if (geodesyDistance(circle, latLng) < options.samplePointDist) {
        return joinCircle(circle, matches, dataPoints);
      }
    }

    return createCircle(latLng, matches, circles, dataPoints);
  }

  CriticalSnake.populatePostprocessOptions({
    detectCircles: {
      tolerance: {
        latitude: 0.001,
        longitude: 0.002,
        timeBefore: 5 * 60 * 1000,
        timeAfter: 10 * 60 * 1000,
        direction: 45,
      },
      samplePointDist: 100,
      minDataPointMatches: 5,
      skipSamplingThreshold: 0,
    }
  });

  this.detectCircles = function(dataPoints) {
    const opts = CriticalSnake.PostProcessOptions.detectCircles;
    const circleIdxs = dataPoints.map(_ => new Set());

    const pointsInTime = ConvexEnvelopeSearch(dataPoints, binarySearch);
    pointsInTime.addDimension({
      lowerBoundTolerance: -opts.tolerance.timeBefore,
      upperBoundTolerance: opts.tolerance.timeAfter,
      value: (item) => item.first_stamp,
    });
    pointsInTime.addDimension({
      lowerBoundTolerance: -opts.tolerance.latitude,
      upperBoundTolerance: opts.tolerance.latitude,
      value: (item) => item.lat,
    });
    pointsInTime.addDimension({
      lowerBoundTolerance: -opts.tolerance.longitude,
      upperBoundTolerance: opts.tolerance.longitude,
      value: (item) => item.lng,
    });

    const dataPointDirDiff = (a, b) => {
      return (dataPoints[a].direction - dataPoints[b].direction + 360) % 360;
    };

    const circles = [];
    for (let i = 0; i < dataPoints.length; i++) {
      if (circleIdxs[i].size > opts.skipSamplingThreshold)
        continue;

      for (const samplePoint of findSamplePoints(dataPoints, i, opts)) {
        const undirectedMatches = pointsInTime.itemsInEnvelope(samplePoint);
        const matches = undirectedMatches.filter(s => {
          return dataPointDirDiff(i, s) < opts.tolerance.direction;
        });

        if (matches.length < opts.minDataPointMatches)
          continue;

        const circle = createOrJoinCircle(matches, circles, dataPoints, opts);
        for (const idx of matches) {
          circleIdxs[idx].add(circle.idx);
        }
      }
    }

    for (let i = 0; i < dataPoints.length; i++) {
      dataPoints[i].circleIdxs = Array.from(circleIdxs[i]);
    }

    return circles;
  }; // CriticalSnake.PostProcessor.detectCircles()

  CriticalSnake.populatePostprocessOptions({
    associateSnakes: {
      startTime: null,
      expectedNumberOfSnakes: -1,
      maxDistance: 2000,
    }
  });

  this.associateSnakes = function(dataPoints, circles, tracks) {
    const opts = CriticalSnake.PostProcessOptions.associateSnakes;
    const snakes = circles.map(_ => new Set());

    const snakeOrigins = [];
    if (!opts.startTime) {
      console.error("Cannot detect snakes without a start time (yet)");
      return null;
    }

    const atStartTime = (circle) => {
      return circle.first_stamp < opts.startTime &&
             circle.last_stamp > opts.startTime;
    };

    for (const circle of circles.filter(atStartTime)) {
      const closeEnough = (c) => geodesyDistance(circle, c) < opts.maxDistance;
      const origin = snakeOrigins.find(circles => circles.some(closeEnough));

      if (origin) {
        origin.push(circle);
      }
      else {
        snakeOrigins.push([ circle ]);
      }
    }

    snakeOrigins.sort((a, b) => b.length - a.length);
    if (opts.expectedNumberOfSnakes != -1) {
      snakeOrigins.slice(0, opts.expectedNumberOfSnakes);
    }

    snakeOrigins.map((snake, snakeIdx) => {
      for (const circle of snake) {
        for (const inCircleIdx of circle.dataPointIdxs) {
          for (const inTrackIdx of tracks[dataPoints[inCircleIdx].trackIdx]) {
            for (const circleIdx of dataPoints[inTrackIdx].circleIdxs) {
              snakes[circleIdx].add(snakeIdx);
            }
          }
        }
      }
    });

    for (let i = 0; i < circles.length; i++) {
      circles[i].snakeIdxs = Array.from(snakes[i]);
    }

    return snakeOrigins.length;
  }; // CriticalSnake.PostProcessor.associateSnakes()

  function allSnakesIn(circles, indexes) {
    return indexes.reduce((snakes, circleIdx) => {
      for (const snakeIdx of circles[circleIdx].snakeIdxs) {
        snakes.add(snakeIdx);
      }
      return snakes;
    }, new Set());
  };

  function snakesEqual(a, b) {
    if (a.size != b.size)
      return false;
    for (const snake of a)
      if (!b.has(snake))
        return false;
    return true;
  };

  CriticalSnake.populatePostprocessOptions({
    populateTrackSegments: {
      minSegmentLength: 10,
      bridgeGapsLookahead: 5,
    }
  });

  this.populateTrackSegments = function(dataPoints, tracks, circles) {
    const opts = CriticalSnake.PostProcessOptions.populateTrackSegments;

    const nextSegment = (track, begin) => {
      const indexes = (i) => dataPoints[track[i]].circleIdxs;
      const snakesBegin = allSnakesIn(circles, indexes(begin));

      const nextDataPointsMajorityInSnake = (first, count) => {
        const end = Math.min(first + count, track.length);
        let inSnake = 0;
        for (let k = first; k < end; k++) {
          const snakes = allSnakesIn(circles, indexes(k));
          if (snakesEqual(snakesBegin, snakes))
            inSnake += 1;
        }
        return inSnake / (end - first) >= 0.5;
      };

      for (let i = begin + 1; i < track.length - 1; i++) {
        // Keep extending the current segment as long as the current data-point
        // or the majority of the upcoming data-points have the same snake
        // signature.
        const snakes = allSnakesIn(circles, indexes(i));
        if (snakesEqual(snakesBegin, snakes))
          continue;

        if (nextDataPointsMajorityInSnake(i + 1, opts.bridgeGapsLookahead))
          continue;

        return [Array.from(snakesBegin), i];
      }

      return [Array.from(snakesBegin), track.length - 1];
    };

    const segments = [];
    for (const track of tracks) {
      let trackPointIdx = 0;
      do {
        const [snakeIdxs, nextIdx] = nextSegment(track, trackPointIdx);

        // nextIdx is the data-point where this segment ends and the next
        // segment starts.
        if (nextIdx - trackPointIdx + 1 >= opts.minSegmentLength) {
          const dataPointIdxs = track.slice(trackPointIdx, nextIdx + 1);
          segments.push({
            first_stamp: minFirstStamp(dataPoints, dataPointIdxs),
            last_stamp: maxLastStamp(dataPoints, dataPointIdxs),
            dataPointIdxs: dataPointIdxs,
            snakeIdxs: snakeIdxs,
          });
        }

        trackPointIdx = nextIdx;
      } while (trackPointIdx < track.length - 1);
    }

    return segments;
  } // // CriticalSnake.PostProcessor.populateTrackSegments

  this.getTimeRange = function(circles) {
    // Find indexes of all circles that are associated with a snake.
    const snakeIdxs = circles.map((c, idx) => c.snakeIdxs.length > 0 ? idx : null)
                             .filter(idx => idx != null);
    return {
      begin: new Date(minFirstStamp(circles, snakeIdxs)),
      end: new Date(maxLastStamp(circles, snakeIdxs)),
    };
  }; // CriticalSnake.PostProcessor.getTimeRange()

  return this;

}; // CriticalSnake.PostProcessor

})(window.CriticalSnake = window.CriticalSnake || {}, L, LatLon);
