const defaultOptions = {
  showStats: true,
  showControls: true,
  showZoom: true,
}

function createBikeMap(L, options) {
  const opts = { ...defaultOptions, ...options };

  let bikeMap = new L.map('osm-map', {
    renderer: L.canvas(),
    zoomControl: false,
  });

  bikeMap.setView([52.5219,13.4045], 13);

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

  if (opts.showStats) {
    L.Control.StatsView = L.Control.extend({
      onAdd: function(map) {
        let stats = L.DomUtil.create('label', 'leaflet-bar');
        stats.id = "stats";
        stats.style.padding = "3px 8px";
        stats.style.backgroundColor = "#fff";
        stats.style.display = "none";
        return stats;
      }
    });
  }

  if (opts.showControls) {
    L.Control.PlaybackCtrls = L.Control.extend({
      onAdd: function(map) {
        let playbackCtrls = L.DomUtil.create('div', 'leaflet-bar');
        playbackCtrls.style.display = "flex";
        playbackCtrls.style.backgroundColor = "#fff";
        playbackCtrls.style.padding = "5px";

        let browse = L.DomUtil.create('input', '', playbackCtrls);
        browse.type = "file";
        browse.id = "browse";
        browse.style.border = "0";

        let progress = L.DomUtil.create('label', '', playbackCtrls);
        progress.id = "progress";
        progress.style.display = "none";

        let playback = L.DomUtil.create('input', '', playbackCtrls);
        playback.type = "button";
        playback.id = "playback";
        playback.value = "▶";
        playback.style.display = "none";
        playback.style.border = "0";

        let slider = L.DomUtil.create('input', '', playbackCtrls);
        slider.type = "range";
        slider.id = "history";
        slider.style.display = "none";

        let fpsLabel = L.DomUtil.create('label', '', playbackCtrls);
        fpsLabel.innerHTML = "FPS:";
        fpsLabel.id = "fpsLabel";
        fpsLabel.htmlFor = "fpsInput";
        fpsLabel.style.padding = "2px 0.33rem 0px 1rem";
        fpsLabel.style.display = "none";

        let fpsInput = L.DomUtil.create('input', '', playbackCtrls);
        fpsInput.type = "number";
        fpsInput.id = "fpsInput";
        fpsInput.min = "1";
        fpsInput.max = "100";
        fpsInput.value = "15";
        fpsInput.style.textAlign = "right";
        fpsInput.style.display = "none";

        L.DomEvent.on(playbackCtrls, 'mouseover', () => {
          map.dragging.disable();
          map.doubleClickZoom.disable();
        }, this);

        L.DomEvent.on(playbackCtrls, 'mouseout', () => {
          map.dragging.enable();
          map.doubleClickZoom.enable();
        }, this);

        L.DomEvent.on(fpsInput, 'keydown', (e) => {
          e.preventDefault();
        });

        return playbackCtrls;
      },

      onRemove: function(map) {
        L.DomEvent.off();
      }
    });
  }

  if (opts.showStats) {
    (new L.Control.StatsView({ position: 'topleft' })).addTo(bikeMap);
  }
  if (opts.showControls) {
    (new L.Control.PlaybackCtrls({ position: 'bottomleft' })).addTo(bikeMap);
  }
  if (opts.showZoom) {
    (new L.Control.Zoom({ position: 'bottomleft' })).addTo(bikeMap);
  }

  bikeMap.browseButton = $("#browse");
  bikeMap.loadingLabel = $("#progress");
  bikeMap.historySlider = $("#history");
  bikeMap.playbackButton = $("#playback");
  bikeMap.statsLabel = $("#stats");
  bikeMap.fpsLabel = $("#fpsLabel");
  bikeMap.fpsInput = $("#fpsInput");

  return bikeMap;
}
