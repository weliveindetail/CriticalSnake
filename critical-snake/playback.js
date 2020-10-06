(function(CriticalSnake, L) {

if (typeof(L) != "object")
  return CriticalSnake.missingDependency("Leaflet");

// Make the playback status accessible to the browser's debug console.
CriticalSnake.PlaybackStatus = {
  running: false,
  frameTime: 0,
  duration: 1,
};

// Make options accessible to the browser's debug console.
CriticalSnake.PlaybackOptions = {
  defaultEnable: {
    // Draw the circles that approximate the current mass.
    drawCircles: true,

    // Draw the tracks on which people have been riding so far.
    drawTracks: !L.Browser.mobile,

    // Automatically reduce FPS if rendering takes more time then the slot
    // currently offers.
    autoLimitFps: true,
  },

  defaultColor: "#888", // grey
  snakeColors: [
    "#c90002", // red
    "#1b3d9f", // blue
    "#ff0099", // pink
    "#005214", // green
    "#8b00ff", // violett
  ],

  // Number of calculated frames per second.
  fps: 20,

  // The speed of the replay relative to realtime.
  speedup: 500,

  zoom: 13,
  center: null,
};

// Use this function to partially override PlaybackOptions.
CriticalSnake.overridePlaybackOptions = function(incoming) {
  // The latest occurrence of a duplicate key takes precedence.
  CriticalSnake.PlaybackOptions =
      CriticalSnake.mergeOptions(CriticalSnake.PlaybackOptions, incoming);
};

// TODO
CriticalSnake.Playback = function() {
  return this;
}; // CriticalSnake.Playback

})(window.CriticalSnake = window.CriticalSnake || {}, L);
