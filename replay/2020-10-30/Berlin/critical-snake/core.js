(function(CriticalSnake, L) {

function isObject(item) {
  return item && typeof(item) === 'object' && !Array.isArray(item);
}

CriticalSnake.mergeOptions = function(target, source) {
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) {
          Object.assign(target, { [key]: {} });
        }
        CriticalSnake.mergeOptions(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  return target;
};

CriticalSnake.missingDependency = function(name) {
  console.error("Cannot instantiate CriticalSnake. Please include", name,
                "first.");
};

})(window.CriticalSnake = window.CriticalSnake || {});
