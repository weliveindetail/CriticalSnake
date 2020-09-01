
function initialCoordBounds() {
  return {
    min: [90.0, 180.0],
    max: [-90.0, -180.0],
    center: []
  };
}

function postprocess_new(dataset, coordFilter) {
  for (const snapshot in dataset) {
    console.log(snapshot);
  }

  return {
    origin: [52.5, 13.4],
    snakeBounds: initialCoordBounds(),
    frames: [{
      coord: [52.51, 13.41],
      snake: null
    }]
  };
}
