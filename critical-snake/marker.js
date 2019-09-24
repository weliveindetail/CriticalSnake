
function createMarkers(L, colors) {
  const markerSizeClass =
    ".map-marker-bike {" +
    "  width: {0}px; height: {0}px;" +
    "  margin-left: -{1}px; margin-top: -{1}px;" +
    "}";

  function initDynamicMarkerSizeCSS(px) {
    let sheet = document.createElement('style');
    sheet.type = 'text/css';
    document.getElementsByTagName('head')[0].appendChild(sheet);
    return sheet.appendChild(
      document.createTextNode(markerSizeClass.format(px, px / 2)));
  }

  let dynNodeCSS = initDynamicMarkerSizeCSS(48);
  this.updateSize = (px) => {
    dynNodeCSS.nodeValue = markerSizeClass.format(px, px / 2);
  };

  const makeMarker = (color) => {
    return L.icon({
      iconUrl: 'img/marker-{0}.png'.format(color),
      className: 'map-marker-bike',
    });
  };

  this.origin = makeMarker("red");

  const grey = makeMarker("grey");
  const snakes = colors
      ? [ makeMarker("blue"), makeMarker("brown"), makeMarker("pink") ]
      : [ makeMarker("blue") ];

  this.bySnakeIdx = (snake) => {
    if (snake == null)
      return grey;
    return snakes[Math.min(snakes.length - 1, snake)];
  };

  return this;
}
