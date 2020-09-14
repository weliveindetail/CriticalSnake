(function(CriticalSnake) {

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

    function back(array) {
      return array.length > 0 ? array[array.length - 1] : null;
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

  function isRelevantTrack(dataPoints, trackIdxs) {
    if (trackIdxs.length < options.trackRestrictions.minDataPoints)
      return false;

    let totalDistance = 0;
    for (let i = 0; i < trackIdxs.length - 1; i++) {
      const fromIdx = trackIdxs[i];
      const toIdx = trackIdxs[i + 1];
      totalDistance += geodesyDistance(dataPoints[fromIdx], dataPoints[toIdx]);
    }

    if (totalDistance < options.trackRestrictions.minTotalDistance)
      return false;

    const firstStamp = minFirstStamp(dataPoints, trackIdxs);
    const lastStamp = maxLastStamp(dataPoints, trackIdxs);
    if (lastStamp - firstStamp < options.trackRestrictions.minTotalDuration)
      return false;

    return true;
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

  this.analyzeTracks = (dataset) => {
    self.indexMap = {};
    self.nextIndex = 0;
    self.filteredDupes = 0;
    self.filteredOutOfRange = 0;

    const trackPoints = [];
    const addTrackPoint = (dataPoint) => {
      return trackPoints.push(dataPoint) - 1;
    };

    const trackPointTracks = [];
    for (const snapshot in dataset) {
      for (const participant in dataset[snapshot]) {
        const dataPoint = importApiVersion2DataPoint(dataset[snapshot][participant]);

        if (!options.coordFilter([ dataPoint.lat, dataPoint.lng ])) {
          self.filteredOutOfRange += 1;
          continue;
        }

        const idx = hashToIdx(participant);
        if (trackPointTracks.length <= idx) {
          trackPointTracks[idx] = [ addTrackPoint(dataPoint) ];
          continue;
        }

        const latest = trackPoints[back(trackPointTracks[idx])];
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
            trackPointTracks[idx] = [ addTrackPoint(dataPoint) ];
          }
          else {
            // Add vector to the latest data-point in the track and push the new
            // data-point on top.
            latest.direction = vector.direction;
            latest.next = dataPoint;
            trackPointTracks[idx].push(addTrackPoint(dataPoint));
          }
        }
      }
    }

    // Return a flat array of data-points from all relevant tracks sorted by
    // ascending timestamps. For convenience we omit the last data-point in each
    // track, because it has no "next" property.
    const relevantTrackPointTracks =
        trackPointTracks.filter(indexes => isRelevantTrack(trackPoints, indexes))
                        .map(track => track.slice(0, -1));

    return reindexTracks(trackPoints, relevantTrackPointTracks);
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

  function createOrJoinCircle(matches, circles, dataPoints) {
    const minute = 60 * 1000;
    const latLng = averageLatLng(dataPoints, matches);
    const stamp = averageFirstStamp(dataPoints, matches).getTime();

    for (let i = circles.length - 1; i >= 0; i--) {
      if (Math.abs(stamp - circles[i].first_stamp.getTime()) < 5 * minute)
        if (geodesyDistance(circles[i], latLng) < 100) {
          return joinCircle(circles[i], matches, dataPoints);
        }
    }

    return createCircle(latLng, matches, circles, dataPoints);
  }

  this.detectCircles = (dataPoints) => {
    for (const dataPoint of dataPoints) {
      dataPoint.circles = new Set();
    }

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

    const dirDiff = (a, b) => (a.direction - b.direction + 360) % 360;

    const circles = [];
    for (const p of dataPoints) {
      if (p.circles.size > 0)
        continue;

      const samplePoints = interpolateLinear(p, p.next, 100);
      for (const samplePoint of samplePoints.slice(0, -1)) {
        const undirectedMatches = pointsInTime.itemsInEnvelope(samplePoint);
        const matches = undirectedMatches.filter(idx => {
          return dirDiff(p, dataPoints[idx]) < 45;
        });

        if (matches.length < 5)
          continue;

        const circle = createOrJoinCircle(matches, circles, dataPoints);
        for (const idx of matches) {
          dataPoints[idx].circles.add(circle.id);
        }
      }
    }

    return circles;
  }; // CriticalSnake.PostProcessor.detectCircles()

  this.getTimeRange = function(circles) {
    const snakeIdxs = circles.map((c, idx) => c.snakes.size > 0 ? idx : null)
                             .filter(idx => idx != null);
    return {
      begin: minFirstStamp(circles, snakeIdxs),
      end: maxLastStamp(circles, snakeIdxs),
    };
  }; // CriticalSnake.PostProcessor.getTimeRange()

  this.associateSnakes = function(dataPoints, circles) {
    for (const dataPoint of dataPoints) {
      dataPoint.snake = null;
    }
    for (const circle of circles) {
      circle.snakes = new Set();
    }

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

  this.populateTrackSegments = function(dataPoints, tracks, circles, minSegmentLength) {

    const nextSegment = (track, begin) => {
      const indexes = (i) => dataPoints[track[i]].circles;
      const snakesBegin = allSnakesIn(circles, indexes(begin));

      const lookaheadDataPointsInSnake = (base, lookahead) => {
        const end = Math.min(base + lookahead, track.length);
        let inSnake = 0;
        for (let k = base; k < end; k++) {
          const snakes = allSnakesIn(circles, indexes(k));
          if (snakesEqual(snakesBegin, snakes))
            inSnake += 1;
        }
        return lookahead * inSnake / (end - base);
      };

      for (let i = begin + 1; i < track.length - 1; i++) {
        // Extend with the current segment as long as the current data-point
        // or the majority of the upcoming data-points have the same snake
        // signature.
        const snakes = allSnakesIn(circles, indexes(i));
        if (snakesEqual(snakesBegin, snakes))
          continue;

        if (lookaheadDataPointsInSnake(i + 1, 5) > 2)
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

        if (nextIdx - trackPointIdx >= minSegmentLength) {
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
  }

  this.indexMap = {};
  this.nextIndex = 0;
  this.filteredDupes = 0;
  this.filteredOutOfRange = 0;

}; // CriticalSnake.PostProcessor

})(window.CriticalSnake = window.CriticalSnake || {});
