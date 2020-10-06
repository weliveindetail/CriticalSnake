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
      const statsLabel = L.DomUtil.create('label', 'leaflet-bar');
      statsLabel.id = "statsLabel";
      statsLabel.style.padding = "3px 8px";
      statsLabel.style.backgroundColor = "#fff";
      controlGroups.push(statsLabel);
      return statsLabel;
    }
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

  (new L.Control.StatsView({ position: 'topleft' })).addTo(bikeMap);
  (new L.Control.BrowseGroup({ position: 'bottomleft' })).addTo(bikeMap);
  (new L.Control.LoadingGroup({ position: 'bottomleft' })).addTo(bikeMap);
  (new L.Control.Zoom({ position: 'bottomleft' })).addTo(bikeMap);

  bikeMap.statsLabel = $("#statsLabel");

  bikeMap.browseGroup = $("#browseGroup");
  bikeMap.browseButton = $("#browseButton");

  bikeMap.loadingGroup = $("#loadingGroup");
  bikeMap.loadingSpinner = $("#loadingSpinner");
  bikeMap.loadingLabel = $("#loadingLabel");

  const mouseEvents = "mouseup mousedown mousemove mousewheel";
  const touchEvents = "touchstart touchend touchmove";
  const dragEvents = "dragstart dragend dragover";

  const relevantEvents = ["click"];
  relevantEvents.push(dragEvents);
  relevantEvents.push(L.Browser.touch ? touchEvents : mouseEvents);
  const eventsStr = relevantEvents.join(' ');

  for (const group of controlGroups) {
    L.DomEvent.on(group, eventsStr, L.DomEvent.stopPropagation);
  }

  return bikeMap;
}
