
L.Control.PostprocessGroup = L.Control.extend({

  options: {
    filterNames: [],
  },

  initialize: function(bikeMap, options) {
    this.bikeMap = bikeMap;
    L.setOptions(this, options);
  },

  show: function() {
    this.groupControl.style.display = "block";
  },

  hide: function() {
    this.groupControl.style.display = "none";
  },

  onAdd: function() {
    const group = this.createGroupControl();

    this.groupControl = group;
    this.locationFilter = this.addLocationFilterControls(group);
    this.timeRangeSlider = this.addTimeRangeControls(group);
    this.addPostProcessButton(group);
    this.addStoreOptionsButton(group);

    //L.DomEvent.on();
    return group;
  },

  onRemove: function() {
    //L.DomEvent.off();
  },

  createGroupControl: function() {
    const group = L.DomUtil.create('div', 'leaflet-bar');
    group.style.display = "block";
    group.style.backgroundColor = "#fff";
    group.style.padding = "20px";
    return group;
  },

  addLocationFilterControls: function(parent) {
    const label = L.DomUtil.create('label', '', parent);
    label.innerHTML = "Select location filter:";

    const select = L.DomUtil.create('select', '', parent);
    select.style.width = "100%";
    select.style.display = "block";
    select.style.marginBottom = "10px";

    for (const filter of this.options.filterNames) {
      const opt = L.DomUtil.create("option", "", select);
      opt.text = filter;
      opt.value = filter;
    }

    select.addEventListener("change", () => {
      this.locationFilterChanged(select.value);
    });

    return select;
  },

  addPostProcessButton: function(parent) {
    const button = L.DomUtil.create("input", "", parent);
    button.type = "button";
    button.value = "Post-process";
    button.style.marginRight = "10px";
    button.addEventListener("click", this.postprocessClicked);
    return button;
  },

  addStoreOptionsButton: function(parent) {
    const button = L.DomUtil.create("input", "", parent);
    button.type = "button";
    button.value = "Store options";
    button.addEventListener("click", this.storeOptionsClicked);
    return button;
  },

  addTimeRangeControls: function(parent) {
    const label = L.DomUtil.create('label', '', parent);
    label.innerHTML = "Select time-range:";
    label.style.marginTop = "10px";

    const slider = L.DomUtil.create("div", "", parent);
    slider.style.width = "200px";
    slider.style.margin = "5px 9px 20px 9px";

    const fmt = (prefix) => ({
      to: val => {
        const pad2 = (val) => (val < 10 ? "0" : "") + val;
        const d = new Date(this.percentToTimestamp(val));
        return `${prefix}: ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
      }
    });

    noUiSlider.create(slider, {
      start: [0, 10, 100],
      connect: true,
      tooltips: [ fmt("Start"), fmt("Origins"), fmt("End") ],
      range: { 'min': 0, 'max': 100 }
    });

    const notifyTimeRangeChanged = (values) => {
      this.timeRangeChanged({
        start: this.percentToTimestamp(parseFloat(values[0])),
        origins: this.percentToTimestamp(parseFloat(values[1])),
        end: this.percentToTimestamp(parseFloat(values[2])),
      });
    }

    for (const tooltip of slider.noUiSlider.getTooltips()) {
      tooltip.style.display = "none";
    }
    slider.noUiSlider.on("start", (values, handleIdx) => {
      const tooltips = slider.noUiSlider.getTooltips();
      tooltips[handleIdx].style.display = "block";
    });
    slider.noUiSlider.on("end", (values, handleIdx) => {
      notifyTimeRangeChanged(values);
      const tooltips = slider.noUiSlider.getTooltips();
      tooltips[handleIdx].style.display = "none";
    });
    slider.noUiSlider.on("change", (values, handleIdx) => {
      notifyTimeRangeChanged(values);
    });

    return slider;
  },

  reset: function(criticalSnake) {
    const trackOpts = criticalSnake.PostProcessOptions.analyzeTracks;
    const snakeOpts = criticalSnake.PostProcessOptions.associateSnakes;

    if (trackOpts) {
      if (criticalSnake.FilterBounds.hasOwnProperty(trackOpts.filterName)) {
        this.locationFilter.value = trackOpts.filterName;
      }
    }

    if (trackOpts && snakeOpts) {
      const stamps = [
        trackOpts.startStamp,
        snakeOpts.startTime,
        trackOpts.endStamp,
      ];
      const percents = stamps.map(this.timestampToPercent);
      this.timeRangeSlider.noUiSlider.set(percents);

      this.timeRangeChanged({
        start: trackOpts.startStamp,
        origins: snakeOpts.startTime,
        end: trackOpts.endStamp,
      });
    }
  },

  // Mandatory overrides

  percentToTimestamp: (percent) => {
    console.error("Missing override in PostprocessGroup: `percentToTimestamp()`");
  },

  timestampToPercent: (stamp) => {
    console.error("Missing override in PostprocessGroup: `timestampToPercent()`");
  },

  // Optional overrides for event subscriptions

  timeRangeChanged: (timeRange) => {
    console.log("TimeRange in PostprocessGroup changed:", timeRange);
  },

  locationFilterChanged: (filterName) => {
    console.log("LocationFilter in PostprocessGroup changed:", filterName);
  },

  postprocessClicked: () => {
    console.log("PostProcessButton in PostprocessGroup clicked");
  },

  storeOptionsClicked: () => {
    console.log("StoreOptionsButton in PostprocessGroup clicked");
  },

});

L.control.addPostprocessGroup = function(map, opts) {
  const group = new L.Control.PostprocessGroup(map, opts);
  group.addTo(map);
}
