
if (!String.prototype.format) {
  String.prototype.format = function() {
    var args = Array.prototype.slice.call(arguments);
    return this.replace(/{(\d+)}/g, function(match, number) {
      return typeof args[number] != 'undefined'
        ? args[number]
        : match
      ;
    });
  };
}

function parseUrlParams(url) {
  const regex = /[?&]([^=#]+)=([^&#]*)/g;
  let params = {};
  let match;
  while(match = regex.exec(url)) {
    params[match[1]] = match[2];
  }
  return params;
}
