(function(CriticalSnake, L) {

if (typeof(L) != "object")
  return CriticalSnake.missingDependency("Leaflet");

// Make the playback status accessible to the browser's debug console.
CriticalSnake.PlaybackStatus = {};

// Make options accessible to the browser's debug console.
CriticalSnake.PlaybackOptions = {
  // Number of calculated frames per second.
  fps: 20,

  // The speed of the replay relative to realtime.
  speedup: 500,

  // Draw the circles that approximate the current mass.
  drawCircles: true,

  // Draw the tracks on which people have been riding so far.
  drawTracks: !L.Browser.mobile,

  // Automatically reduce FPS if rendering takes more time then the slot
  // currently offers.
  autoLimitFps: true,

  // The color of raw tracks and circles not associated with a snake.
  defaultColor: "#00f",

  // The opacity of raw tracks.
  defaultOpacity: 0.1,

  // Colors for tracks and circles by snake-index.
  snakeColors: [
    "#c90002", // red
    "#1b3d9f", // blue
    "#ff0099", // pink
    "#005214", // green
    "#8b00ff", // violett
  ],

  // Zoom level when starting the replay.
  zoom: 13,

  // LatLng to pan the view to, when the replay starts.
  center: null,
};

// Use this function to partially override PlaybackOptions.
CriticalSnake.overridePlaybackOptions = function(incoming) {
  // The latest occurrence of a duplicate key takes precedence.
  CriticalSnake.PlaybackOptions =
      CriticalSnake.mergeOptions(CriticalSnake.PlaybackOptions, incoming);
};

CriticalSnake.Playback = function(bikeMap) {

  const emptyDataset = {
    dataPoints: [],
    tracks: [],
    circles: [],
    segments: [],
    begin: Date.now(),
    end: Date.now() + 1000,
  };

  this.dataset = { ...emptyDataset };

  const highlights = L.layerGroup([], { pane: "markerPane" });
  const shadows = L.layerGroup([], { pane: "shadowPane" });

  this.setDataset = (data) => {
    Object.assign(this.dataset, { ...emptyDataset, ...data });
  };

  this.drawScene = (playbackTime) => {
    bikeMap.removeLayer(highlights);
    bikeMap.removeLayer(shadows);

    // Draw raw tracks if we have no post-processing data. Count bikes while
    // drawing.
    if (this.dataset.circles.length == 0 && this.dataset.segments.length == 0) {
      const visibleBikes = drawRawTracks(shadows, this.dataset.dataPoints,
                                         this.dataset.tracks, playbackTime);
      shadows.addTo(bikeMap);
      return visibleBikes;
    }

    // Draw post-processed tracks. It's not really suitable for counting bikes.
    if (CriticalSnake.PlaybackOptions.drawTracks) {
      drawTracks(shadows, this.dataset.dataPoints, this.dataset.segments,
                 playbackTime);
      shadows.addTo(bikeMap);
    }

    // Draw post-processed circles and count bikes while drawing.
    if (CriticalSnake.PlaybackOptions.drawCircles) {
      const visibleBikes = drawCircles(highlights, this.dataset.dataPoints,
                                        this.dataset.circles, playbackTime);
      highlights.addTo(bikeMap);
      return visibleBikes;
    }

    // If we didn't draw circles, we count bikes explicitly.
    return countVisibleBikes();
  }

  function drawRawTracks(canvas, dataPoints, tracks, stamp, range, opacity) {
    range = range || 10;
    opacity = opacity || CriticalSnake.PlaybackOptions.defaultOpacity;

    canvas.clearLayers();

    const minute = 60 * 1000;
    const withinLast10Minutes = (idx) => {
      if (dataPoints[idx].first_stamp <= stamp)
        if (dataPoints[idx].last_stamp > stamp - range * minute)
          return true;
      return false;
    };

    let visibleBikes = 0;
    for (const track of tracks) {
      const dataPointIdxs = track.filter(withinLast10Minutes);
      const coords = dataPointIdxs.map(idx => dataPoints[idx]);
      if (coords.length > 1) {
        visibleBikes += 1;
        canvas.addLayer(
            L.polyline(coords, {
              color: CriticalSnake.PlaybackOptions.defaultColor,
              opacity: opacity
            }));
      }
    }

    shadows.addTo(bikeMap);
    return visibleBikes;
  }

  function colors(snakeIdx) {
    const colors = CriticalSnake.PlaybackOptions.snakeColors;

    if (snakeIdx >= 0 && snakeIdx < colors.length)
      return colors[snakeIdx];

    return CriticalSnake.PlaybackOptions.defaultColor;
  }

  function drawTracks(canvas, dataPoints, segments, stamp) {
    canvas.clearLayers();

    const startedAlready = (seg) => seg.first_stamp <= stamp;
    const didNotStartYet = (idx) => !startedAlready(dataPoints[idx]);

    const findEndIndex = (seg) => {
      if (seg.last_stamp <= stamp)
        return -1;
      return seg.dataPointIdxs.findIndex(idx => didNotStartYet(idx));
    };

    for (const segment of segments.filter(startedAlready)) {
      // Draw non-associated track segments?
      //if (segment.snakeIdxs.length == 0)
      //  continue;

      // Draw segment entirely or only the first number of data-points.
      const end = findEndIndex(segment);
      const coordIdxs = end < 0 ? segment.dataPointIdxs
                                : segment.dataPointIdxs.slice(0, end);

      for (const snakeIdx of segment.snakeIdxs) {
        canvas.addLayer(
            L.polyline(coordIdxs.map(idx => dataPoints[idx]), {
              color: colors(snakeIdx),
              opacity: 0.05
            }));
      }
    }
  }

  function drawCircles(canvas, dataPoints, circles, stamp) {
    canvas.clearLayers();

    const fullCircle = (c, idx) => L.circle(c, {
      color: colors(idx),
      fillOpacity: 0.75,
      radius: 10 * Math.log2(c.dataPointIdxs.length),
      stroke: false,
    });

    const semiCircle = (c, idx, from, to) => L.semiCircle(c, {
      color: colors(idx),
      fillOpacity: 0.75,
      radius: 10 * Math.log2(c.dataPointIdxs.length),
      startAngle: from,
      stopAngle: to,
      stroke: false,
    });

    const inTime = (c) => c.first_stamp <= stamp && c.last_stamp >= stamp;

    const trackIdxs = new Set();
    for (const circle of circles.filter(c => inTime(c))) {
      circle.dataPointIdxs.forEach(idx => trackIdxs.add(dataPoints[idx].trackIdx));
      switch (circle.snakeIdxs.length) {
        case 0:
          canvas.addLayer(fullCircle(circle, null));
          break;
        case 1:
          canvas.addLayer(fullCircle(circle, circle.snakeIdxs[0]));
          break;
        default:
          let angle = (stamp / (3 * 1000)) % 360;
          const arcSize = 360 / circle.snakeIdxs.length;
          for (const idx of circle.snakeIdxs) {
            canvas.addLayer(semiCircle(circle, idx, angle, angle + arcSize));
            angle += arcSize;
          }
          break;
      }
    }

    return trackIdxs.size;
  }

  function countVisibleBikes(dataPoints, tracks, stamp, range) {
    range = range || 10;

    const minute = 60 * 1000;
    const withinRange = (idx) => {
      if (dataPoints[idx].first_stamp <= stamp)
        if (dataPoints[idx].last_stamp > stamp - range * minute)
          return true;
      return false;
    };

    const accumulateBikes = (sum, trackDataPoints) => {
      const visible = (trackDataPoints.filter(withinRange).length > 1);
      return sum + (visible ? 1 : 0);
    };

    return tracks.reduce(accumulateBikes, 0);
  }

  return this;
}; // CriticalSnake.Playback

})(window.CriticalSnake = window.CriticalSnake || {}, L);
