/******************************************************************************
 * Caption Stage View (Adaptive 4 lines + highlight + title)
 * + Image support: if slide has an image, show ONLY that image
 * + Blackout overlay fades in when OpenLP "Blank to Screen" is active
 ******************************************************************************/

window.OpenLP = {
  isBlank: false,
  currentSlides: [],
  currentSlide: 0,
  currentItem: null,
  currentService: null,
  myTwelve: false,
  songTitle: "",

  myWebSocket: function () {
    const host = window.location.hostname;
    const websocket_port = 4317;

    ws = new WebSocket(`ws://${host}:${websocket_port}`);

    ws.onmessage = (event) => {
      const reader = new FileReader();
      reader.onload = () => {
        const info = JSON.parse(reader.result.toString()).results;

        // Detect OpenLP "Blank to Screen"
        // Full OpenLP blank detection (same as vmix version)
        OpenLP.display = info.display || "";       // "show", "blank", "theme", "desktop"
        OpenLP.isBlank = info.blank || false;      // boolean
        OpenLP.isThemeBlank = info.theme || false; // theme blank


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
   * updateCaption() — Smart 4-line caption with highlight & blank support
   ***********************************************************************/
  updateCaption: function () {
    const slide = OpenLP.currentSlides[OpenLP.currentSlide];
    const linesElem = $("#lines");
    const titleElem = $("#song-title");

    // --- If operator pressed BLANK ---
    const forceBlank =
        OpenLP.display === "blank" ||
        OpenLP.display === "theme" ||
        OpenLP.display === "desktop" ||
        OpenLP.isBlank === true ||
        OpenLP.isThemeBlank === true;

    if (forceBlank) {
        OpenLP.showBlackout();
        return;
    }


    // If we are NOT blank → overlay must disappear
    OpenLP.hideBlackout();

    if (!slide) {
      linesElem.html("");
      titleElem.html("");
      return;
    }

    // ----------- IMAGE SUPPORT -----------
    const imgSrc = slide.img || "";
    if (imgSrc.trim() !== "") {
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

    // Ensure normal text mode layout
    $("#caption-container").removeClass("image-mode");

    // Helper: fetch slide text
    function getText(idx) {
      if (!OpenLP.currentSlides[idx]) return "";
      var t = OpenLP.currentSlides[idx]["text"] || "";
      return t.replace(/\r/g, "").replace(/\n/g, "<br>").trim();
    }

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

    // Step 3: If no text → show blackout
    if (collected.length === 0) {
      linesElem.html("");
      titleElem.html("");
      OpenLP.showBlackout();
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

    // Step 5: Pad to 4 lines for layout consistency
    while (collected.length < 4) {
      html += `<div class="line">&nbsp;</div>`;
      collected.push("");
    }

    linesElem.html(html);
    titleElem.html(OpenLP.songTitle || "");
  },

  /***********************************************************************
   * Blackout overlay control
   ***********************************************************************/
  showBlackout: function () {
    $("#blackout").addClass("visible");
  },

  hideBlackout: function () {
    $("#blackout").removeClass("visible");
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

/* Clock updater */
$.ajaxSetup({ cache: false });
setInterval(() => OpenLP.updateClock(), 500);

/* Start WebSocket */
OpenLP.myWebSocket();
