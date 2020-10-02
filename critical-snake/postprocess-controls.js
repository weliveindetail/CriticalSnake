
L.Control.PostprocessGroup = L.Control.extend({

  options: {
    filterNames: [],
    snakeColors: [],
    locationFilter: "",
    timeRange: { startStamp: 0, originsStamp: 0, endStamp: 8640000000000000 },
  },

  initialize: function(options) {
    if (!typeof(Picker) == "function") {
      console.error("Cannot instantiate postprocess controls.",
                    "Please include vanilla-picker first.");
      return;
    }
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
    this.snakeColorPickers = this.addSnakeColorPickers(group);
    this.addPostProcessButton(group);
    this.addStoreOptionsButton(group);

    return group;
  },

  onRemove: function() {},

  createGroupControl: function() {
    const group = L.DomUtil.create('div', 'leaflet-bar');
    group.style.display = "block";
    group.style.backgroundColor = "#fff";
    group.style.padding = "10px";

    if (!L.Browser.touch) {
      L.DomEvent.disableClickPropagation(group);
      L.DomEvent.on(group, 'mousewheel', L.DomEvent.stopPropagation);
    } else {
      L.DomEvent.on(group, 'click', L.DomEvent.stopPropagation);
    }

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

    L.DomEvent.on(select, "change", () => {
      this.locationFilterChanged(select.value);
    });

    // Take over initial value from options.
    if (this.options.locationFilter) {
      select.value = this.options.locationFilter;
    }

    return select;
  },

  addPostProcessButton: function(parent) {
    const button = L.DomUtil.create("input", "", parent);
    button.type = "button";
    button.value = "Post-process";
    button.style.marginRight = "10px";
    L.DomEvent.on(button, "click", this.postprocessClicked);
    return button;
  },

  addStoreOptionsButton: function(parent) {
    const button = L.DomUtil.create("input", "", parent);
    button.type = "button";
    button.value = "Store options";
    L.DomEvent.on(button, "click", this.storeOptionsClicked);
    return button;
  },

  pickColor: function(colorBox, onSuccess) {
    const dialog = new Picker({
      parent: colorBox,
      popup: "left",
      color: colorBox.style.backgroundColor,
    });
    dialog.onDone = onSuccess;
    dialog.openHandler();
  },

  createColorPickerBox: function(color, customHandler) {
    customHandler = customHandler || false;

    const box = document.createElement("div");
    box.style.display = "inline-block";
    box.style.width = "20px";
    box.style.height = "20px";
    box.style.boxShadow = "1px 1px 2px #aaa";
    box.style.borderRadius = "2px";
    box.style.marginRight = "4px";
    box.style.marginBottom = "4px";
    box.style.backgroundColor = color;
    box.style.cursor = "pointer";

    // Workaround inconform positioning if plusButton was the only one with text.
    box.innerHTML = "&nbsp;";

    if (!customHandler) {
      this._DomEventOn(box, "click", () => {
        this.pickColor(box, (col) => {
          box.style.backgroundColor = col.hex;
        });
      });
    }

    return box;
  },

  addSnakeColorPickers: function(parent) {
    const boxes = [];

    const label = L.DomUtil.create('label', '', parent);
    label.innerHTML = "Select snake colors:";

    const container = L.DomUtil.create('div', '', parent);
    container.style.marginBottom = "8px";
    container.style.maxWidth = "200px";

    const plusButton = this.createColorPickerBox("#fff", true);
    plusButton.innerHTML = "+";
    plusButton.style.textAlign = "center";
    plusButton.style.border = "1px solid #666";
    plusButton.style.boxShadow = "inset 0 0 1px #FFF, inset 0 1px 7px #EBEBEB, 0 3px 6px -3px #BBB";
    container.appendChild(plusButton);

    const appendNewBox = (color) => {
      const box = this.createColorPickerBox(color);
      container.insertBefore(box, plusButton);
      boxes.push(box);
    };

    L.DomEvent.on(plusButton, "click", () => {
      this.pickColor(plusButton, color => appendNewBox(color.hex));
    });

    this.options.snakeColors.forEach(appendNewBox);

    return boxes;
  },

  addTimeRangeControls: function(parent) {
    const label = L.DomUtil.create('label', '', parent);
    label.innerHTML = "Select time-range:";
    label.style.marginTop = "10px";

    const slider = L.DomUtil.create("div", "", parent);
    slider.style.width = "200px";
    slider.style.margin = "5px 9px 15px 9px";

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

    if (this.options.timeRange.endStamp != 0) {
      // Take over initial value from options.
      const opts = this.options.timeRange;
      const stamps = [ opts.startStamp, opts.originsStamp, opts.endStamp ];
      const percents = stamps.map(this.timestampToPercent);
      slider.noUiSlider.set(percents);

      this.timeRangeChanged({
        start: opts.startStamp,
        origins: opts.originsStamp,
        end: opts.endStamp,
      });
    } else {
      // Otherwise, store defaults as initial values in options.
      const percents = [0, 10, 100];
      const stamps = percents.map(this.percentToTimestamp);
      this.options.timeRange = {
        startStamp: stamps[0],
        originsStamp: stamps[1],
        endStamp: stamps[2],
      };
    }

    return slider;
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

  snakeColorChanged: (idx, color) => {
    console.log("In PostprocessGroup color of snake-index", idx, "changed to:",
                color);
  },

  postprocessClicked: () => {
    console.log("PostProcessButton in PostprocessGroup clicked");
  },

  storeOptionsClicked: () => {
    console.log("StoreOptionsButton in PostprocessGroup clicked");
  },

});
