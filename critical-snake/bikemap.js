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
      fpsInput.value = "15";
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

      controlGroups.push(playbackGroup);
      return playbackGroup;
    },
  });

  L.Control.PostprocessGroup = L.Control.extend({
    onAdd: function() {
      const postprocessGroup = L.DomUtil.create('div', 'leaflet-bar');
      postprocessGroup.id = "postprocessGroup";
      postprocessGroup.style.display = "block";
      postprocessGroup.style.backgroundColor = "#fff";
      postprocessGroup.style.padding = "1rem";

      const selectLocationFilterLabel = L.DomUtil.create('label', '', postprocessGroup);
      selectLocationFilterLabel.innerHTML = "Select location filter:";
      selectLocationFilterLabel.id = "selectLocationFilterLabel";
      selectLocationFilterLabel.style.padding = "0 3px";

      const selectLocationFilter = L.DomUtil.create('select', '', postprocessGroup);
      selectLocationFilter.id = "selectLocationFilter";
      selectLocationFilter.style.display = "block";
      selectLocationFilter.style.margin = "3px 3px 10px";
      selectLocationFilter.style.width = "calc(100% - 7px)";

      for (const filter in CriticalSnake.FilterBounds) {
        const opt = L.DomUtil.create('option', '', selectLocationFilter);
        opt.text = filter;
        opt.value = filter;
      }

      const selectTimeRangeLabel = L.DomUtil.create('label', '', postprocessGroup);
      selectTimeRangeLabel.innerHTML = "Select time-range:";
      selectTimeRangeLabel.id = "selectTimeRangeLabel";
      selectTimeRangeLabel.style.padding = "0 3px";

      const selectTimeRangeSlider = L.DomUtil.create("div", "", postprocessGroup);
      selectTimeRangeSlider.id = "selectTimeRangeSlider";
      selectTimeRangeSlider.style.width = "200px";
      selectTimeRangeSlider.style.margin = "0.75rem";

      bikeMap.percentToTimestamp = (percent) => percent;
      const toolTipFmt = (prefix) => ({
        to: val => {
          const pad2 = (val) => (val < 10 ? "0" : "") + val;
          const d = new Date(bikeMap.percentToTimestamp(val));
          return `${prefix}: ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
        }
      });

      noUiSlider.create(selectTimeRangeSlider, {
        start: [0, 10, 100],
        connect: true,
        tooltips: [toolTipFmt("Start"), toolTipFmt("Origins"), toolTipFmt("End")],
        range: { 'min': 0, 'max': 100 }
      });

      bikeMap.updateTimeRangeOptions = () => {
        const values = selectTimeRangeSlider.noUiSlider.get();

        // Here we use the jQuery element that's assigned in the end of
        // createBikeMap() in order to trigger the event on the client side.
        // It's quite a hack, but fine for now.
        bikeMap.selectTimeRangeSlider.trigger("change", {
          start: bikeMap.percentToTimestamp(parseFloat(values[0])),
          origins: bikeMap.percentToTimestamp(parseFloat(values[1])),
          end: bikeMap.percentToTimestamp(parseFloat(values[2])),
        });
      }

      for (const tooltip of selectTimeRangeSlider.noUiSlider.getTooltips()) {
        tooltip.style.display = "none";
      }
      selectTimeRangeSlider.noUiSlider.on("start", (values, handleIdx) => {
        const tooltips = selectTimeRangeSlider.noUiSlider.getTooltips();
        tooltips[handleIdx].style.display = "block";
      });
      selectTimeRangeSlider.noUiSlider.on("end", (values, handleIdx) => {
        bikeMap.updateTimeRangeOptions();
        const tooltips = selectTimeRangeSlider.noUiSlider.getTooltips();
        tooltips[handleIdx].style.display = "none";
      });
      selectTimeRangeSlider.noUiSlider.on("change", (values, handleIdx) => {
        bikeMap.updateTimeRangeOptions();
      });

      const postprocessButton = L.DomUtil.create("input", "", postprocessGroup);
      postprocessButton.id = "postprocessButton";
      postprocessButton.type = "button";
      postprocessButton.value = "Run post-processor";
      postprocessButton.style.marginTop = "2em";

      // Stopping event propagation for the parent Leaflet bar works well with
      // builtin controls, but currently breaks the drag functionality of the
      // NoUiSlider. So for now, we don't do it for this control group.
      //controlGroups.push(postprocessGroup);

      return postprocessGroup;
    }
  });

  (new L.Control.StatsView({ position: 'topleft' })).addTo(bikeMap);
  (new L.Control.BrowseGroup({ position: 'bottomleft' })).addTo(bikeMap);
  (new L.Control.LoadingGroup({ position: 'bottomleft' })).addTo(bikeMap);
  (new L.Control.PlaybackGroup({ position: 'bottomleft' })).addTo(bikeMap);
  (new L.Control.PostprocessGroup({ position: 'topright' })).addTo(bikeMap);
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

  bikeMap.postprocessGroup = $("#postprocessGroup");
  bikeMap.selectTimeRangeSlider = $("#selectTimeRangeSlider");
  bikeMap.selectLocationFilter = $("#selectLocationFilter");
  bikeMap.postprocessButton = $("#postprocessButton");

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
