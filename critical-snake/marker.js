function makeIcon(color) {
  return L.icon({
    iconUrl: 'img/marker-{0}.png'.format(color),
    className: 'map-marker-bike',
  });
}

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

  this.origin = makeIcon("red");

  const grey = makeIcon("grey");
  const snakes = colors
      ? [ makeIcon("blue"), makeIcon("brown"), makeIcon("pink") ]
      : [ makeIcon("blue") ];

  this.bySnakeIdx = (snake) => {
    if (snake == null)
      return grey;
    return snakes[Math.min(snakes.length - 1, snake)];
  };

  return this;
}
