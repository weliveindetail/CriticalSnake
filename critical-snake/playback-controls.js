
L.Control.PlaybackGroup = L.Control.extend({

  options: {
    fps: 20,
    speedup: 500,
    autoLimitFps: true,
    status: {
      running: false,
      frameTime: 0,
      duration: 1,
    },
  },

  // Public interface

  initialize: function(options) {
    L.setOptions(this, options);
  },

  show: function() {
    this.groupControl.style.display = "flex";
  },

  hide: function() {
    this.groupControl.style.display = "none";
  },

  // `setTimeRange()` must be called at least once before playback starts.
  // It can be called again without rebuilding the UI.
  setTimeRange: function(firstStamp, lastStamp) {
    this.options.status.frameTime = firstStamp;
    this.options.status.duration = lastStamp - firstStamp;

    this._permilleToTimestamp = (permille) => {
      const duration = this.options.status.duration;
      const offset = Math.round(duration * parseFloat(permille) / 1000);
      return firstStamp + offset;
    };
    this._timestampToPermille = (timestamp) => {
      const duration = this.options.status.duration;
      const offset = (timestamp - firstStamp);
      return (offset / duration) * 1000;
    };

    this.historySlider.value = this._timestampToPermille(firstStamp);
  },

  _permilleToTimestamp: (permille) => {
    console.error("Missing initialization of PlaybackGroup: call `setTimeRange(begin, end)`");
  },

  _timestampToPermille: (stamp) => {
    console.error("Missing initialization of PlaybackGroup: call `setTimeRange(begin, end)`");
  },

  // Optional overrides and event subscriptions

  playbackToggled: (running) => {
    console.log("Playback button clicked in PlaybackGroup");
  },

  renderFrame: (timestamp) => {
    console.log("Trigger rendering for a new frame from PlaybackGroup");
  },

  limitFps: (fps) => {
    console.log("Accepting autoLimitFPS:", fps);
    return true;
  },

  // Implementation

  onAdd: function() {
    this.groupControl = this._createGroupControl();
    this.playbackButton = this._addPlaybackButton(this.groupControl);
    this.historySlider = this._addHistorySlider(this.groupControl);
    this._addFpsControls(this.groupControl);

    return this.groupControl;
  },

  onRemove: function() {
    this.groupControl = null;
    this.historySlider = null;
  },

  _createGroupControl: function() {
    const group = L.DomUtil.create('div', 'leaflet-bar');
    group.style.display = "none";
    group.style.alignItems = "center";
    group.style.backgroundColor = "#fff";
    group.style.padding = "5px";

    if (!L.Browser.touch) {
      L.DomEvent.disableClickPropagation(group);
      L.DomEvent.on(group, 'mousewheel', L.DomEvent.stopPropagation);
    } else {
      L.DomEvent.on(group, 'click', L.DomEvent.stopPropagation);
    }

    return group;
  },

  _setPlaybackState: function(running) {
    this.playbackButton.value = (running ? "||" : "▶");
    this.options.status.running = running;
    this.playbackToggled(running);
  },

  _nextFrame: function(increment) {
    this.options.status.frameTime += increment;
    const permille = this._timestampToPermille(this.options.status.frameTime);
    if (permille >= 1000) {
      this.historySlider.value = 1000;
      this._setPlaybackState(false);
      return false;
    }
    else if (this.options.status.running) {
      this.historySlider.value = permille;
      return true;
    }
    else {
      return false;
    }
  },

  _mayLimitFps: function(begin, frameDuration) {
    if (this.options.autoLimitFps) {
      const runtime = Date.now() - begin;
      if (runtime > frameDuration && this.limitFps(1000 / runtime)) {
        this.options.fps = 1000 / runtime;
      }
    }
  },

  _runPlayback: function() {
    // If we sit on the last frame, then restart automatically.
    if (this.historySlider.value == 1000) {
      this.historySlider.value = 0;
      this.options.status.frameTime = this._permilleToTimestamp(0);
    }
    else {
      this.historySlider.value = this._timestampToPermille(this.options.status.frameTime);
    }

    // The playback loop retriggers itself via the continuation.
    const loop = (loop) => {
      const loopBegin = Date.now();

      // Increment frameTime, update controls states and schedule next frame.
      const frameDuration = 1000 / this.options.fps;
      if (this._nextFrame(frameDuration * this.options.speedup)) {
        setTimeout(() => loop(loop), frameDuration);
      }

      // Actually draw the frame.
      this.renderFrame(this.options.status.frameTime);

      // Reduce FPS if execution time exceeds available time per frame.
      this._mayLimitFps(loopBegin, frameDuration);
    };

    loop(loop);
  },

  _addPlaybackButton: function(parent) {
    const button = L.DomUtil.create('input', '', parent);
    button.type = "button";
    button.value = "▶";
    button.style.width = "2rem";
    button.style.height = "1.5rem";
    button.style.border = "0";

    L.DomEvent.on(button, "click", () => {
      this._setPlaybackState(!this.options.status.running);
      if (this.options.status.running)
        this._runPlayback();
    });

    return button;
  },

  _addHistorySlider: function(parent) {
    const slider = L.DomUtil.create('input', '', parent);
    slider.type = "range";
    slider.min = 0;
    slider.max = 1000;
    slider.value = 0;

    // Handle change and mouse-move with button pressed.
    L.DomEvent.on(slider, "change mousemove", (e) => {
      if (e.buttons == 0)
        return;
      const stamp = this._permilleToTimestamp(parseFloat(slider.value));
      this.options.status.frameTime = stamp;
      this.renderFrame(stamp);
    });

    return slider;
  },

  _addFpsControls: function(parent) {
    const label = L.DomUtil.create('label', '', parent);
    label.innerHTML = "Speedup:";
    label.htmlFor = "fpsInput";
    label.style.padding = "0 5px";
    label.style.marginLeft = "0.5rem";

    const input = L.DomUtil.create('input', '', parent);
    input.type = "number";
    input.id = "fpsInput";
    input.min = 50;
    input.max = 9000;
    input.step = 50;
    input.value = Math.round(this.options.speedup / 50) * 50;
    input.style.width = "3rem";
    input.style.textAlign = "right";

    L.DomEvent.on(input, "keydown", e => e.preventDefault());
    L.DomEvent.on(input, "change", e => {
      const value = Math.round(parseInt(input.value) / 50) * 50;
      this.options.speedup = value;
      input.value = value;
    });

    return input;
  },

});
