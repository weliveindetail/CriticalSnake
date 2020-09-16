(function(CriticalSnake) {

CriticalSnake.PostProcessor = function(options) {

  function numericRange(min, max) {
    this.contains = (val) => min < val && max > val;
    return this;
  }

  this.coordFilters = {
    Berlin: function() {
      const latRange = new numericRange(52.40, 52.61);
      const lngRange = new numericRange(13.23, 13.56);
      return (x) => !latRange.contains(x.lat) || !lngRange.contains(x.lng);
    },
    Barcelona: function() {
      const latRange = numericRange(41.26, 41.45);
      const lngRange = numericRange(2.00, 2.29);
      return (x) => !latRange.contains(x.lat) || !lngRange.contains(x.lng);
    },
  };

  function importApiVersion2DataPoint(dataPoint) {
    const floatCoord = (oldFormat) => {
      let chars = oldFormat.toString().split('');
      chars.splice(-6, 0, '.');
      return parseFloat(chars.join(''));
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

  function isDuplicate(latest, next) {
    if (latest.last_stamp == next.last_stamp)
      return true;
    if (latest.lat == next.lat && latest.lng == next.lng)
      return true;
    return false;
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
    // nextIdx that points to the next dataPoint in the track or indicates the
    // end of the track (null).
    const tracks = perTrackPoolIdxs.map(oldTrackIdxs => {
      const newTrackIdxs = [ lookup[oldTrackIdxs[0]] ];
      for (let i = 1; i < oldTrackIdxs.length; i++) {
        const oldIdx = oldTrackIdxs[i];
        const newIdx = lookup[oldIdx];

        const predInTrack = dataPoints[back(newTrackIdxs)];
        predInTrack.direction = geodesyBearing(predInTrack, dataPoints[newIdx]);
        predInTrack.nextIdx = newIdx;

        newTrackIdxs.push(newIdx);
      }
      dataPoints[back(newTrackIdxs)].nextIdx = null;
      return newTrackIdxs;
    });

    return [ tracks, dataPoints ];
  }

  const analyzeTracksOptions = {
    coordFilter: this.coordFilters.Berlin(),
    trackFilter: {
      minDataPoints: 8,
      minDistance: 1000,
      minDuration: 5 * 60 * 1000,
    },
    splitConditions : {
      maxGapDuration: 5 * 60 * 1000,
      maxGapDistance: 1000,
    },
  };

  this.analyzeTracks = function(dataset, options) {
    const opts = { ...analyzeTracksOptions, ...options };

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
    let filteredOutOfRange = 0;

    const pool = [];
    const perTrackPoolIdxs = [];

    for (const snapshot in dataset) {
      for (const participant in dataset[snapshot]) {
        const dataPoint = importApiVersion2DataPoint(dataset[snapshot][participant]);

        if (opts.coordFilter(dataPoint)) {
          filteredOutOfRange += 1;
          continue;
        }

        const trackIdx = hashToIdx(participant);
        if (perTrackPoolIdxs.length <= trackIdx) {
          perTrackPoolIdxs[trackIdx] = [ pool.length ];
          pool.push(dataPoint);
          continue;
        }

        const latest = pool[back(perTrackPoolIdxs[trackIdx])];
        if (isDuplicate(latest, dataPoint)) {
          // Extend the duration of the latest data-point. Don't add the
          // current data-point to the pool.
          latest.last_stamp = dataPoint.last_stamp;
          filteredDupes += 1;
          continue;
        }

        if (splitTrack(latest, dataPoint, opts.splitConditions)) {
          // Create a new track starting with this data-point.
          const newTrackIdx = newIdxForHash(participant);
          perTrackPoolIdxs[newTrackIdx] = [ pool.length ];
          pool.push(dataPoint);
        }
        else {
          // Add the dataPoint to the track and the pool.
          perTrackPoolIdxs[trackIdx].push(pool.length);
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
    console.log("Filtered", filteredOutOfRange, "data points outside area of interest");
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
    const nextIdx = dataPoints[idx].nextIdx;
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
      id: circles.length,
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

  const detectCirclesOptions = {
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
  };

  this.detectCircles = function(dataPoints, options) {
    const opts = { ...detectCirclesOptions, ...options };
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
          circleIdxs[idx].add(circle.id);
        }
      }
    }

    for (let i = 0; i < dataPoints.length; i++) {
      dataPoints[i].circles = Array.from(circleIdxs[i]);
    }

    return circles;
  }; // CriticalSnake.PostProcessor.detectCircles()

  const associateSnakesOptions = {
    startTime: null,
    expectedNumberOfSnakes: -1,
    maxDistance: 2000,
  };

  this.associateSnakes = function(dataPoints, circles, options) {
    const opts = { ...associateSnakesOptions, ...options };
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

    snakeOrigins.map((snake, snakeId) => {
      for (const circle of snake) {
        for (const idx of circle.dataPointIdxs) {
          for (let p = dataPoints[idx]; p.nextIdx; p = dataPoints[p.nextIdx]) {
            for (const circleId of p.circles) {
              snakes[circleId].add(snakeId);
            }
          }
        }
      }
    });

    for (let i = 0; i < circles.length; i++) {
      circles[i].snakes = Array.from(snakes[i]);
    }

    return snakeOrigins.length;
  }; // CriticalSnake.PostProcessor.associateSnakes()

  function allSnakesIn(circles, indexes) {
    return indexes.reduce((snakes, circleIdx) => {
      for (const snakeId of circles[circleIdx].snakes) {
        snakes.add(snakeId);
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

  const populateTrackSegmentsOptions = {
    minSegmentLength: 10,
    bridgeGapsLookahead: 5,
  };

  this.populateTrackSegments = function(dataPoints, tracks, circles, options) {
    const opts = { ...populateTrackSegmentsOptions, ...options };

    const nextSegment = (track, begin) => {
      const indexes = (i) => dataPoints[track[i]].circles;
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
        const [snakeIds, nextIdx] = nextSegment(track, trackPointIdx);

        // nextIdx is the data-point where this segment ends and the next
        // segment starts.
        if (nextIdx - trackPointIdx + 1 >= opts.minSegmentLength) {
          const segmentIdxs = track.slice(trackPointIdx, nextIdx + 1);
          segments.push({
            first_stamp: minFirstStamp(dataPoints, segmentIdxs),
            last_stamp: maxLastStamp(dataPoints, segmentIdxs),
            dataPointIdxs: segmentIdxs,
            snakes: snakeIds,
          });
        }

        trackPointIdx = nextIdx;
      } while (trackPointIdx < track.length - 1);
    }

    return segments;
  } // // CriticalSnake.PostProcessor.populateTrackSegments

  this.getTimeRange = function(circles) {
    // Find indexes of all circles that are associated with a snke.
    const snakeIdxs = circles.map((c, idx) => c.snakes.length > 0 ? idx : null)
                             .filter(idx => idx != null);
    return {
      begin: new Date(minFirstStamp(circles, snakeIdxs)),
      end: new Date(maxLastStamp(circles, snakeIdxs)),
    };
  }; // CriticalSnake.PostProcessor.getTimeRange()

}; // CriticalSnake.PostProcessor

})(window.CriticalSnake = window.CriticalSnake || {});
