/******************************************************************************
 * Caption Stage View (Adaptive 4 lines + highlight + title)
 * + Image support: if slide has an image, show ONLY that image
 ******************************************************************************/

window.OpenLP = {
  myWebSocket: function () {
    const host = window.location.hostname;
    const websocket_port = 4317;

    ws = new WebSocket(`ws://${host}:${websocket_port}`);

    ws.onmessage = (event) => {
      const reader = new FileReader();
      reader.onload = () => {
        const info = JSON.parse(reader.result.toString()).results;

        OpenLP.myTwelve = info.twelve;

        if (OpenLP.currentItem != info.item ||
            OpenLP.currentService != info.service) {

          OpenLP.currentItem = info.item;
          OpenLP.currentService = info.service;
          OpenLP.loadSlides();
        }
        else if (OpenLP.currentSlide != info.slide) {
          OpenLP.currentSlide = parseInt(info.slide, 10);
          OpenLP.updateCaption();
        }

        OpenLP.loadService();
      };
      reader.readAsText(event.data);
    };
  },

  loadService: function () {
    $.getJSON("/api/v2/service/items", function (data) {
      $("#notes").html("");

      data.forEach(function (item, index) {
        if (item.selected) {
          OpenLP.songTitle = item.title || "";

          if (data.length > index + 1)
            OpenLP.nextSong = data[index + 1].title;
          else
            OpenLP.nextSong = "End of Service";
        }
      });

      OpenLP.updateCaption();
    });
  },

  loadSlides: function () {
    $.getJSON("/api/v2/controller/live-items", function (data) {
      OpenLP.currentSlides = data.slides;
      OpenLP.currentSlide = 0;

      data.slides.forEach((slide, idx) => {
        if (slide["selected"]) OpenLP.currentSlide = idx;
      });

      OpenLP.loadService();
    });
  },

  /***********************************************************************
   * updateCaption() — Smart 4-line caption with conditional highlight
   * - NEW: If slide has an image → show the image ONLY
   * - Skip empty slides
   * - Always show up to 4 lines
   * - Highlight ONLY if the actual current slide had text
   ***********************************************************************/
  updateCaption: function () {
    const slide = OpenLP.currentSlides[OpenLP.currentSlide];
    const linesElem = $("#lines");
    const titleElem = $("#song-title");

    if (!slide) {
      linesElem.html("");
      titleElem.html("");
      return;
    }

// ----------- IMAGE SUPPORT -----------
const imgSrc = slide.img || "";
if (imgSrc.trim() !== "") {
  // Tell CSS we're in image mode
  $("#caption-container").addClass("image-mode");

  linesElem.html(`
    <div class="line line-current">
      <img class="caption-image" src="${imgSrc}">
    </div>
  `);
  titleElem.html(OpenLP.songTitle || "");
  return;
}
// -------------------------------------

    // -------------------------------------

    // Helper: fetch slide text
    function getText(idx) {
      if (!OpenLP.currentSlides[idx]) return "";
      var t = OpenLP.currentSlides[idx]["text"] || "";
      return t.replace(/\r/g, "").replace(/\n/g, "<br>").trim();
    }

// Ensure normal text mode layout
$("#caption-container").removeClass("image-mode");

var collected = [];


    var collected = [];

    // Step 1: Detect if CURRENT slide has text
    var currentText = getText(OpenLP.currentSlide);
    var currentHasText = currentText !== "";

    // Step 2: Collect up to 4 non-empty lines starting at currentSlide
    var idx = OpenLP.currentSlide;
    while (collected.length < 4 && idx < OpenLP.currentSlides.length) {
      var txt = getText(idx);
      if (txt !== "") collected.push(txt);
      idx++;
    }

    // Step 3: If nothing exists, clear
    if (collected.length === 0) {
      linesElem.html("");
      titleElem.html("");
      return;
    }

    // Step 4: Build final HTML
    var html = "";
    for (var i = 0; i < collected.length; i++) {
      if (i === 0 && currentHasText)
        html += `<div class="line line-current">${collected[i]}</div>`;
      else
        html += `<div class="line">${collected[i]}</div>`;
    }

    // Step 5: Pad to always show 4 lines
    while (collected.length < 4) {
      html += `<div class="line">&nbsp;</div>`;
      collected.push("");
    }

    linesElem.html(html);
    titleElem.html(OpenLP.songTitle || "");
  },

  updateClock: function () {
    var t = new Date();
    var h = t.getHours();
    if (OpenLP.myTwelve && h > 12) h -= 12;
    var m = t.getMinutes();
    if (m < 10) m = "0" + m;
    $("#clock").html(h + ":" + m);
  }
};

$.ajaxSetup({ cache: false });
setInterval(() => OpenLP.updateClock(), 500);
OpenLP.myWebSocket();
