// TowerScreenshot's save in a WebGL build: the PNG straight into the
// browser's downloads, as the web game does (js/shot.js). Where it lands,
// and whether the browser asks first, is the browser's own setting.
mergeInto(LibraryManager.library, {
  UwuStackDownload: function (namePtr, bytesPtr, length) {
    var name = UTF8ToString(namePtr);
    var bytes = HEAPU8.slice(bytesPtr, bytesPtr + length);
    var url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 10000);
  },
});
