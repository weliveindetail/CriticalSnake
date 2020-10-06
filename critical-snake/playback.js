(function(CriticalSnake, L) {

function missingDependency(name) {
  console.error("Cannot instantiate CriticalSnake. Please include", name,
                "first.");
}
if (typeof(L) != "object")
  return missingDependency("Leaflet");

// Make the playback status accessible to the browser's debug console.
CriticalSnake.PlaybackStatus = {
  running: false,
  frameTime: 0,
  duration: 1,
};

// Make options accessible to the browser's debug console.
CriticalSnake.PlaybackOptions = {
  defaultEnable: {
    drawCircles: true,
    drawTracks: !L.Browser.mobile,
  },
  defaultColor: "#888", // grey
  snakeColors: [
    "#c90002", // red
    "#1b3d9f", // blue
    "#ff0099", // pink
    "#005214", // green
    "#8b00ff", // violett
  ],
  fps: 20,
  zoom: 13,
  center: null,
};

function isObject(item) {
  return item && typeof(item) === 'object' && !Array.isArray(item);
}

function mergeDeep(target, source) {
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key])
          Object.assign(target, { [key]: {} });
        mergeDeep(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  return target;
}

// Use this function to partially override PlaybackOptions.
CriticalSnake.mergePlaybackOptions = function(incoming) {
  // The latest occurrence of a duplicate key takes precedence.
  CriticalSnake.PlaybackOptions =
      mergeDeep(CriticalSnake.PlaybackOptions, incoming);
};

// TODO
CriticalSnake.Playback = function() {
  return this;
}; // CriticalSnake.Playback

})(window.CriticalSnake = window.CriticalSnake || {}, L);
