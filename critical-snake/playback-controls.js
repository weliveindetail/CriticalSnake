
L.Control.PlaybackGroup = L.Control.extend({

  options: {
    fps: 20,
    status: {
      running: false,
      frameTime: 0,
      duration: 1,
    },
  },

  initialize: function(options) {
    L.setOptions(this, options);
  },

  show: function() {
    this.groupControl.style.display = "flex";
  },

  hide: function() {
    this.groupControl.style.display = "none";
  },

  isRunning: function() {
    return this.options.status.running || false;
  },

  _permilleToTimestamp: (permille) => {
    console.error("Missing initialization of PlaybackGroup: call `setTimeRange(begin, end)`");
  },

  _timestampToPermille: (stamp) => {
    console.error("Missing initialization of PlaybackGroup: call `setTimeRange(begin, end)`");
  },

  setTimeRange: function(firstStamp, lastStamp) {
    if (!this.groupControl) {
      console.error("Cannot set time range: the control is not part of the map");
      return;
    }

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

  onAdd: function() {
    this.groupControl = this.createGroupControl();
    this.addPlaybackButton(this.groupControl);
    this.historySlider = this.addHistorySlider(this.groupControl);
    this.addFpsControls(this.groupControl);

    return this.groupControl;
  },

  onRemove: function() {
    this.groupControl = null;
    this.historySlider = null;
  },

  createGroupControl: function() {
    const group = L.DomUtil.create('div', 'leaflet-bar');
    group.style.display = "flex";
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

  _runPlayback: function() {
    this.renderFrame(this.options.status.frameTime);
    this.historySlider.value = this._timestampToPermille(this.options.status.frameTime);

    // The playback loop retriggers itself via the continuation.
    const loop = (loop) => {
      console.log(this.options.status);
      this.options.status.frameTime += 50 * 100; // speed factor 100 at 20fps
      this.renderFrame(this.options.status.frameTime);

      const permille = this._timestampToPermille(this.options.status.frameTime);
      if (permille >= 1000) {
        this.historySlider.value = 1000;
      }
      else if (this.options.status.running) {
        this.historySlider.value = Math.round(permille);
        setTimeout(() => loop(loop), 50); // 20 fps
      }
    };

    loop(loop);
  },

  addPlaybackButton: function(parent) {
    const button = L.DomUtil.create('input', '', parent);
    button.type = "button";
    button.value = "▶";
    button.style.border = "0";

    L.DomEvent.on(button, "click", () => {
      if (this.options.status.running) {
        button.value = "▶";
        this.options.status.running = false;
        this.playbackToggled(this.options.status.running);
      }
      else {
        button.value = "||";
        this.options.status.running = true;
        this.playbackToggled(this.options.status.running);
        this._runPlayback();
      }
    });
  },

  addHistorySlider: function(parent) {
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

  addFpsControls: function(parent) {
    const input = L.DomUtil.create('input', '', parent);
    input.type = "number";
    input.id = "fpsInput";
    input.min = "1";
    input.max = "100";
    input.value = this.options.fps;
    input.style.width = "3rem";
    input.style.textAlign = "right";
    input.style.marginLeft = "0.5rem";

    const label = L.DomUtil.create('label', '', parent);
    label.innerHTML = "x";
    label.htmlFor = "fpsInput";
    label.style.padding = "0 3px";

    L.DomEvent.on(input, "change", value => this.fpsChanged(parseInt(value)));
    L.DomEvent.on(input, "keydown", e => e.preventDefault());

    return input;
  },

  // Optional overrides for event subscriptions

  playbackToggled: (running) => {
    console.log("Playback button clicked in PlaybackGroup");
  },

  renderFrame: (timestamp) => {
    console.log("Trigger rendering for a new frame from PlaybackGroup");
  },

  fpsChanged: (fps) => {
    console.log("FPS changed in PlaybackGroup changed:", filterName);
  }

});
