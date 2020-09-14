(function(CriticalSnake) {

  CriticalSnake.PostProcessor = function(options) {

  const self = this;

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
    const stamp = new Date(dataPoint.timestamp * 1000);
    return {
      first_stamp: stamp,
      last_stamp: stamp,
      lat: floatCoord(dataPoint.latitude),
      lng: floatCoord(dataPoint.longitude)
    };
  }

  function splitTrack(vector, options) {
    if (vector.duration > options.maxGapDuration) {
      return true;
    }
    if (vector.distance > options.maxGapDistance) {
      return true;
    }
    return false;
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

  function reindexTracks(pool, perTrackIdxs) {
    const trackPointIdxs = perTrackIdxs.flat();
    trackPointIdxs.sort((a, b) => pool[a].first_stamp - pool[b].first_stamp);

    const lookup = Array.from(Array(trackPointIdxs.length)).fill(-1);
    trackPointIdxs.forEach((oldIdx, newIdx) => lookup[oldIdx] = newIdx);

    const dataPoints = trackPointIdxs.map(idx => pool[idx]);
    const tracks = perTrackIdxs.map(track => track.map(oldIdx => lookup[oldIdx]));

    return [
      tracks,
      dataPoints
    ];
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

    const trackPoints = [];
    const trackPointTracks = [];

    for (const snapshot in dataset) {
      for (const participant in dataset[snapshot]) {
        const dataPoint = importApiVersion2DataPoint(dataset[snapshot][participant]);

        if (opts.coordFilter(dataPoint)) {
          filteredOutOfRange += 1;
          continue;
        }

        const idx = hashToIdx(participant);
        if (trackPointTracks.length <= idx) {
          trackPoints.push(dataPoint);
          trackPointTracks[idx] = [ trackPoints.length - 1 ];
          continue;
        }

        const latest = trackPoints[back(trackPointTracks[idx])];
        if (isDuplicate(latest, dataPoint)) {
          // Extend the duration of the latest data-point.
          latest.last_stamp = dataPoint.last_stamp;
          filteredDupes += 1;
          continue;
        }

        const vector = calculateVector(latest, dataPoint);
        if (vector) {
          if (splitTrack(vector, opts.splitConditions)) {
            // Drop the vector and create a new track for this data-point.
            const idx = newIdxForHash(participant);
            trackPoints.push(dataPoint);
            trackPointTracks[idx] = [ trackPoints.length - 1 ];
          }
          else {
            // Add vector to the latest data-point in the track and push the new
            // data-point on top.
            latest.direction = vector.direction;
            latest.next = dataPoint;
            trackPoints.push(dataPoint);
            trackPointTracks[idx].push(trackPoints.length - 1);
          }
        }
      }
    }

    console.log("Filtered", filteredDupes, "duplicate data points");
    console.log("Filtered", filteredOutOfRange, "data points outside area of interest");

    // Return a flat array of data-points from all relevant tracks sorted by
    // ascending timestamps. For convenience we omit the last data-point in each
    // track, because it has no "next" property.
    const trackFilter = (indexes) => isRelevantTrack(trackPoints, indexes,
                                                     opts.trackFilter);
    const descendingLengthOrder = (trackA, trackB) => trackB.length - trackA.length;
    const dropEveryLastDataPoint = (track) => track.slice(0, -1);

    const relTrackPointTracks = trackPointTracks.filter(trackFilter)
                                                .sort(descendingLengthOrder)
                                                .map(dropEveryLastDataPoint);

    return reindexTracks(trackPoints, relTrackPointTracks);
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
    const accStamp = (sum, x) => sum + dataPoints[x].first_stamp.getTime();
    return new Date(indexes.reduce(accStamp, 0) / indexes.length);
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
    const stampBase = c1.first_stamp.getTime();
    const stampIncr = (c2.last_stamp.getTime() - stampBase) / (points.length - 1);

    for (let i = 0, f = 0, s = stampBase; i < points.length; i++) {
      const geodesyLatLon = p1.intermediatePointTo(p2, f);
      points[i] = {
        lat: geodesyLatLon.lat,
        lng: geodesyLatLon.lon,
        first_stamp: new Date(s),
        last_stamp: new Date(s),
        direction: c1.direction
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

    for (const dataPoint of dataPoints) {
      dataPoint.circles = new Set();
    }

    const pointsInTime = ConvexEnvelopeSearch(dataPoints, binarySearch);
    pointsInTime.addDimension({
      lowerBoundTolerance: -opts.tolerance.timeBefore,
      upperBoundTolerance: opts.tolerance.timeAfter,
      value: (item) => item.first_stamp.getTime(),
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

    const dirDiff = (a, b) => (a.direction - b.direction + 360) % 360;

    const circles = [];
    for (const p of dataPoints) {
      if (p.circles.size > opts.skipSamplingThreshold)
        continue;

      const samplePoints = interpolateLinear(p, p.next, opts.samplePointDist);
      for (const samplePoint of samplePoints.slice(0, -1)) {
        const undirectedMatches = pointsInTime.itemsInEnvelope(samplePoint);
        const matches = undirectedMatches.filter(idx => {
          return dirDiff(p, dataPoints[idx]) < opts.tolerance.direction;
        });

        if (matches.length < opts.minDataPointMatches)
          continue;

        const circle = createOrJoinCircle(matches, circles, dataPoints, opts);
        for (const idx of matches) {
          dataPoints[idx].circles.add(circle.id);
        }
      }
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

    for (const circle of circles) {
      circle.snakes = new Set();
    }

    const snakeOrigins = [];
    if (!opts.startTime) {
      console.error("Cannot detect snakes without a start time (yet)");
      return null;
    }

    const atStartTime = (circle) => {
      return circle.first_stamp.getTime() < opts.startTime &&
             circle.last_stamp.getTime() > opts.startTime;
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
          for (let p = dataPoints[idx]; p.next; p = p.next) {
            for (const circleId of p.circles) {
              circles[circleId].snakes.add(snakeId);
            }
          }
        }
      }
    });

    return snakeOrigins;
  }; // CriticalSnake.PostProcessor.associateSnakes()

  function allSnakesIn(circles, indexes) {
    return Array.from(indexes).reduce((snakes, circleIdx) => {
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
        // Extend with the current segment as long as the current data-point
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
    const snakeIdxs = circles.map((c, idx) => c.snakes.size > 0 ? idx : null)
                             .filter(idx => idx != null);
    return {
      begin: minFirstStamp(circles, snakeIdxs),
      end: maxLastStamp(circles, snakeIdxs),
    };
  }; // CriticalSnake.PostProcessor.getTimeRange()

}; // CriticalSnake.PostProcessor

})(window.CriticalSnake = window.CriticalSnake || {});
