/******************************************************************************
 * LED Banner Caption JS (single-line, auto-scaling, 192 px)
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
          OpenLP.updateBanner();
        }

        OpenLP.loadService();
      };
      reader.readAsText(event.data);
    };
  },

  loadService: function () {
    $.getJSON("/api/v2/service/items", function (data) {
      data.forEach(function (item) {
        if (item.selected) {
          OpenLP.songTitle = item.title || "";
        }
      });

      OpenLP.updateBanner();
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
 * updateBanner() — Single-line LED caption logic
 * - Show ONLY current slide text
 * - If current slide is empty → show nothing
 ***********************************************************************/
updateBanner: function () {
    function getText(idx) {
      if (!OpenLP.currentSlides[idx]) return "";
      let t = OpenLP.currentSlides[idx]["text"] || "";
      return t.replace(/\r/g, "").replace(/\n/g, " ").trim();
    }

    // Only use current slide
    let txt = getText(OpenLP.currentSlide);

    // If empty, display nothing
    if (!txt) {
      $("#line-current").html("");
      return;
    }

    // Render text
    $("#line-current").html(txt);
},


  updateClock: function () {}
};

$.ajaxSetup({ cache: false });
OpenLP.myWebSocket();
