const defaultOptions = {
  center: [52.5219, 13.4045],
  zoom: 13,
}

function createBikeMap(L, options) {
  const bikeMap = new L.map('osm-map', {
    ...defaultOptions,
    ...options,
    renderer: L.canvas(),
    zoomControl: false,
    touchZoom: true,
  });

  const wiki = {
    url: "https://foundation.wikimedia.org/wiki/Maps_Terms_of_Use",
    title: "Wikimedia maps",
  };
  const osm = {
    url: "http://osm.org/copyright",
    title: "OpenStreetMap",
  };

  bikeMap.addLayer(L.tileLayer(
    'https://{s}.tile.osm.org/{z}/{x}/{y}.png',
    { attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors' }
  ));


  const disableClickThrough = function(control) {
    if (!L.Browser.touch) {
      L.DomEvent.disableClickPropagation(control);
      L.DomEvent.on(control, 'mousewheel', L.DomEvent.stopPropagation);
    } else {
      L.DomEvent.on(control, 'click', L.DomEvent.stopPropagation);
    };
    return control;
  };

  L.Control.StatsView = L.Control.extend({
    onAdd: function() {
      this.label = L.DomUtil.create('label', 'leaflet-bar');
      this.label.style.padding = "3px 8px";
      this.label.style.backgroundColor = "#fff";
      this.label.style.display = "none";
      return disableClickThrough(this.label);
    },

    update: function(time, bikeCount) {
      // Adds a leading "0" for single digit values.
      const OO = (val) => (val < 10 ? "0" : "") + val;
      const d = new Date(time);
      this.label.innerHTML =
          `📅 ${d.getFullYear()}-${OO(d.getMonth() + 1)}-${OO(d.getDate())} ` +
          `🕗 ${OO(d.getHours())}:${OO(d.getMinutes())} ` +
          `📍🚲 ${bikeCount}`;
    },

    show: function() {
      this.label.style.display = "block";
    },

    hide: function() {
      this.label.style.display = "none";
    },
  });

  L.Control.BrowseGroup = L.Control.extend({
    onAdd: function() {
      this.group = L.DomUtil.create('div', 'leaflet-bar');
      this.group.style.display = "none";
      this.group.style.alignItems = "center";
      this.group.style.backgroundColor = "#fff";
      this.group.style.padding = "5px";

      const browseButton = L.DomUtil.create('input', '', this.group);
      browseButton.type = "file";
      browseButton.style.border = "0";

      const self = this;
      L.DomEvent.on(browseButton, "change", function() {
        if (this.files.length > 0) {
          self.fileSelected(this.files[0]);
        }
      });

      return disableClickThrough(this.group);
    },

    show: function() {
      this.group.style.display = "flex";
    },

    hide: function() {
      this.group.style.display = "none";
    },

    fileSelected: function(e) {
      console.log("Selected file in BrowseGroup:", e);
    },
  });

  L.Control.LoadingGroup = L.Control.extend({
    onAdd: function() {
      this.group = L.DomUtil.create('div', 'leaflet-bar');
      this.group.style.display = "none";
      this.group.style.alignItems = "center";
      this.group.style.backgroundColor = "#fff";
      this.group.style.padding = "5px";

      const loadingSpinner = L.DomUtil.create('img', '', this.group);
      loadingSpinner.id = "loadingSpinner";
      loadingSpinner.src = "img/spinner-icon-gif-29.gif";
      loadingSpinner.style.height = "1.5em";

      const loadingLabel = L.DomUtil.create('label', '', this.group);
      loadingLabel.id = "loadingLabel";
      loadingLabel.innerHTML = "Loading";
      loadingLabel.style.margin = "0 0.33em";

      return disableClickThrough(this.group);
    },

    show: function() {
      this.group.style.display = "flex";
    },

    hide: function() {
      this.group.style.display = "none";
    },
  });

  bikeMap.zoomButtons = new L.Control.Zoom({ position: 'bottomleft' });
  bikeMap.statsLabel = new L.Control.StatsView({ position: 'topleft' });
  bikeMap.browseGroup = new L.Control.BrowseGroup({ position: 'bottomleft' });
  bikeMap.loadingGroup = new L.Control.LoadingGroup({ position: 'bottomleft' });

  return bikeMap;
}
