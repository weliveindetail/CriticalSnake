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

  L.Control.PlaybackGroup = L.Control.extend({
    onAdd: function() {
      const playbackGroup = L.DomUtil.create('div', 'leaflet-bar');
      playbackGroup.id = "playbackGroup";
      playbackGroup.style.display = "flex";
      playbackGroup.style.alignItems = "center";
      playbackGroup.style.backgroundColor = "#fff";
      playbackGroup.style.padding = "5px";

      const downloadButton = L.DomUtil.create('input', '', playbackGroup);
      downloadButton.id = "downloadButton";
      downloadButton.type = "button";
      downloadButton.value = "💾";
      downloadButton.style.border = "0";
      downloadButton.style.marginRight = "0.4em";

      const playbackButton = L.DomUtil.create('input', '', playbackGroup);
      playbackButton.id = "playbackButton";
      playbackButton.type = "button";
      playbackButton.value = "▶";
      playbackButton.style.border = "0";

      const historySlider = L.DomUtil.create('input', '', playbackGroup);
      historySlider.id = "historySlider";
      historySlider.type = "range";

      const fpsInput = L.DomUtil.create('input', '', playbackGroup);
      fpsInput.type = "number";
      fpsInput.id = "fpsInput";
      fpsInput.min = "1";
      fpsInput.max = "100";
      fpsInput.value = "25";
      fpsInput.style.width = "3rem";
      fpsInput.style.textAlign = "right";
      fpsInput.style.marginLeft = "0.5rem";

      const fpsLabel = L.DomUtil.create('label', '', playbackGroup);
      fpsLabel.innerHTML = "FPS";
      fpsLabel.id = "fpsLabel";
      fpsLabel.htmlFor = "fpsInput";
      fpsLabel.style.padding = "0 3px";

      L.DomEvent.on(fpsInput, 'keydown', (e) => {
        e.preventDefault();
      });

      const tracksOption = L.DomUtil.create('input', '', playbackGroup);
      tracksOption.id = "tracksOption";
      tracksOption.type = "checkbox";
      tracksOption.checked = !L.Browser.mobile;
      tracksOption.style.marginLeft = "10px";

      const tracksOptionLabel = L.DomUtil.create('label', '', playbackGroup);
      tracksOptionLabel.innerHTML = "Tracks";
      tracksOptionLabel.htmlFor = "tracksOption";
      tracksOptionLabel.style.padding = "0 3px";

      controlGroups.push(playbackGroup);
      return playbackGroup;
    },
  });

  (new L.Control.StatsView({ position: 'topleft' })).addTo(bikeMap);
  (new L.Control.BrowseGroup({ position: 'bottomleft' })).addTo(bikeMap);
  (new L.Control.LoadingGroup({ position: 'bottomleft' })).addTo(bikeMap);
  (new L.Control.PlaybackGroup({ position: 'bottomleft' })).addTo(bikeMap);
  (new L.Control.Zoom({ position: 'bottomleft' })).addTo(bikeMap);

  bikeMap.statsLabel = $("#statsLabel");

  bikeMap.browseGroup = $("#browseGroup");
  bikeMap.browseButton = $("#browseButton");

  bikeMap.loadingGroup = $("#loadingGroup");
  bikeMap.loadingSpinner = $("#loadingSpinner");
  bikeMap.loadingLabel = $("#loadingLabel");

  bikeMap.playbackGroup = $("#playbackGroup");
  bikeMap.downloadButton = $("#downloadButton");
  bikeMap.playbackButton = $("#playbackButton");
  bikeMap.historySlider = $("#historySlider");
  bikeMap.fpsInput = $("#fpsInput");
  bikeMap.fpsLabel = $("#fpsLabel");
  bikeMap.tracksOption = $("#tracksOption");

  if (L.Browser.touch) {
    for (const group of controlGroups) {
      L.DomEvent.on(group, 'click', L.DomEvent.stopPropagation);
      L.DomEvent.on(group, 'touchstart', L.DomEvent.stopPropagation);
      L.DomEvent.on(group, 'touchmove', L.DomEvent.stopPropagation);
      L.DomEvent.on(group, 'touchend', L.DomEvent.stopPropagation);
    }
  }
  else {
    for (const group of controlGroups) {
      L.DomEvent.disableClickPropagation(group);
      L.DomEvent.on(group, 'mousewheel', L.DomEvent.stopPropagation);
    }
  }

  return bikeMap;
}
