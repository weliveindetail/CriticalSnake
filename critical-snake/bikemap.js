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
    'https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png',
    { attribution: `<a href="${wiki.url}">${wiki.title}</a> | ` +
                   `&copy; <a href="${osm.url}">${osm.title}</a>` }));

  const controlGroups = [];

  L.Control.StatsView = L.Control.extend({
    onAdd: function() {
      this.label = L.DomUtil.create('label', 'leaflet-bar');
      this.label.style.padding = "3px 8px";
      this.label.style.backgroundColor = "#fff";
      this.label.style.display = "none";
      controlGroups.push(this.label);
      return this.label;
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
      const browseGroup = L.DomUtil.create('div', 'leaflet-bar');
      browseGroup.id = "browseGroup";
      browseGroup.style.display = "flex";
      browseGroup.style.alignItems = "center";
      browseGroup.style.backgroundColor = "#fff";
      browseGroup.style.padding = "5px";

      const browseButton = L.DomUtil.create('input', '', browseGroup);
      browseButton.id = "browseButton";
      browseButton.type = "file";
      browseButton.style.border = "0";

      controlGroups.push(browseGroup);
      return browseGroup;
    },
  });

  L.Control.LoadingGroup = L.Control.extend({
    onAdd: function() {
      const loadingGroup = L.DomUtil.create('div', 'leaflet-bar');
      loadingGroup.id = "loadingGroup";
      loadingGroup.style.display = "flex";
      loadingGroup.style.alignItems = "center";
      loadingGroup.style.backgroundColor = "#fff";
      loadingGroup.style.padding = "5px";

      const loadingSpinner = L.DomUtil.create('img', '', loadingGroup);
      loadingSpinner.id = "loadingSpinner";
      loadingSpinner.src = "img/spinner-icon-gif-29.gif";
      loadingSpinner.style.height = "1.5em";

      const loadingLabel = L.DomUtil.create('label', '', loadingGroup);
      loadingLabel.id = "loadingLabel";
      loadingLabel.innerHTML = "Loading";
      loadingLabel.style.margin = "0 0.33em";

      controlGroups.push(loadingGroup);
      return loadingGroup;
    },
  });

  bikeMap.zoomButtons = new L.Control.Zoom({ position: 'bottomleft' });
  bikeMap.statsLabel = new L.Control.StatsView({ position: 'topleft' });

  (new L.Control.BrowseGroup({ position: 'bottomleft' })).addTo(bikeMap);
  (new L.Control.LoadingGroup({ position: 'bottomleft' })).addTo(bikeMap);

  bikeMap.browseGroup = $("#browseGroup");
  bikeMap.browseButton = $("#browseButton");

  bikeMap.loadingGroup = $("#loadingGroup");
  bikeMap.loadingSpinner = $("#loadingSpinner");
  bikeMap.loadingLabel = $("#loadingLabel");

  for (const group of controlGroups) {
    if (!L.Browser.touch) {
      L.DomEvent.disableClickPropagation(group);
      L.DomEvent.on(group, 'mousewheel', L.DomEvent.stopPropagation);
    } else {
      L.DomEvent.on(group, 'click', L.DomEvent.stopPropagation);
    }
  }

  return bikeMap;
}
