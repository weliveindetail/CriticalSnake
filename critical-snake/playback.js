(function(CriticalSnake, _, L) {

function missingDependency(name) {
  console.error("Cannot instantiate CriticalSnake. Please include", name,
                "first.");
}
if (typeof(_) != "function")
  return missingDependency("Lodash");
if (typeof(L) != "object")
  return missingDependency("Leaflet");

// Make options accessible from the browser's debug console.
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

// Use this function to partially override PlaybackOptions.
CriticalSnake.mergePlaybackOptions = function(incoming) {
  // In lodash's merge implementation, the latest occurrence of a duplicate key
  // takes precedence.
  CriticalSnake.PlaybackOptions =
      _.merge(CriticalSnake.PlaybackOptions, incoming);
};

// TODO
CriticalSnake.Playback = function() {
  return this;
}; // CriticalSnake.Playback

})(window.CriticalSnake = window.CriticalSnake || {}, _, L);
