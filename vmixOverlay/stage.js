/******************************************************************************
 * OpenLP - Open Source Lyrics Projection                                      *
 * --------------------------------------------------------------------------- *
 * Copyright (c) 2008-2021 OpenLP Developers                                   *
 * --------------------------------------------------------------------------- *
 * This program is free software; you can redistribute it and/or modify it     *
 * under the terms of the GNU General Public License as published by the Free  *
 * Software Foundation; version 2 of the License.                              *
 *                                                                             *
 * This program is distributed in the hope that it will be useful, but WITHOUT *
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or       *
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for    *
 * more details.                                                               *
 *                                                                             *
 * You should have received a copy of the GNU General Public License along     *
 * with this program; if not, write to the Free Software Foundation, Inc., 59  *
 * Temple Place, Suite 330, Boston, MA 02111-1307 USA                          *
 ******************************************************************************/

window.OpenLP = {
  // Connect to the OpenLP Remote WebSocket to get pushed updates
  myWebSocket: function (data, status) {
    const host = window.location.hostname;
    const websocket_port = 4317;
    var myTwelve;

    ws = new WebSocket(`ws://${host}:${websocket_port}`);
    ws.onmessage = (event) => {
      const reader = new FileReader();
      reader.onload = () => {
        data = JSON.parse(reader.result.toString()).results;
        // set some global var
        OpenLP.myTwelve = data.twelve;
        // Save display mode from WebSocket
        OpenLP.display = data.display || "";   // "show", "blank", "theme", "desktop"
        OpenLP.isBlank = data.blank || false;  // true = blanked
        OpenLP.isThemeBlank = data.theme || false; // true = blank to theme/background

        if (OpenLP.currentItem != data.item ||
            OpenLP.currentService != data.service) {

          OpenLP.currentItem = data.item;
          OpenLP.currentService = data.service;
          OpenLP.loadSlides();
        }
        else if (OpenLP.currentSlide != data.slide) {
          OpenLP.currentSlide = parseInt(data.slide, 10);
          OpenLP.updateSlide();
        }

        OpenLP.loadService();
      };
      reader.readAsText(event.data);
    };
  },

  loadService: function (event) {
    $.getJSON(
      "/api/v2/service/items",
      function (data, status) {
        OpenLP.nextSong = "";
        $("#notes").html("");

        data.forEach(function (item, index, array) {
          if (item.selected) {
            $("#notes").html(item.notes);

            if (data.length > index + 1)
              OpenLP.nextSong = data[index + 1].title;
            else
              OpenLP.nextSong = "End of Service";
          }
        });

        OpenLP.updateSlide();
      }
    );
  },

  loadSlides: function (event) {
    $.getJSON(
      "/api/v2/controller/live-items",
      function (data, status) {
        OpenLP.currentSlides = data.slides;
        OpenLP.currentSlide = 0;
        OpenLP.currentTags = Array();

        var div = $("#verseorder");
        div.html("");

        var tag = "";
        var tags = 0;
        var lastChange = 0;

        $.each(data.slides, function (idx, slide) {
          var prevtag = tag;
          tag = slide["tag"];

          if (tag != prevtag) {
            lastChange = idx;
            tags = tags + 1;
            div.append("&nbsp;<span>");
            $("#verseorder span")
              .last()
              .attr("id", "tag" + tags)
              .text(tag);
          }
          else {
            if ((slide["text"] == data.slides[lastChange]["text"]) &&
                (data.slides.length >= idx + (idx - lastChange))) {

              var match = true;

              for (var idx2 = 0; idx2 < idx - lastChange; idx2++) {
                if (data.slides[lastChange + idx2]["text"] != data.slides[idx + idx2]["text"]) {
                  match = false;
                  break;
                }
              }

              if (match) {
                lastChange = idx;
                tags = tags + 1;
                div.append("&nbsp;<span>");
                $("#verseorder span")
                  .last()
                  .attr("id", "tag" + tags)
                  .text(tag);
              }
            }
          }

          OpenLP.currentTags[idx] = tags;

          if (slide["selected"])
            OpenLP.currentSlide = idx;
        });

        OpenLP.loadService();
      }
    );
  },

  /***********************************************************************
   * updateSlide() — lyric-overlay behaviour
   * - Current slide: use ONLY slide["text"]
   * - If empty/whitespace: show nothing (no song title fallback)
   ***********************************************************************/
  updateSlide: function () {

    // ---------------------------------------------------------
    // 1. BLANK / DESKTOP / BACKGROUND → vMix overlay MUST HIDE
    // ---------------------------------------------------------
    if (
      OpenLP.display === "blank" ||      // blank to black OR blank to theme
      OpenLP.display === "desktop" ||    // operating system desktop
      OpenLP.display === "theme" ||      // show background only
      OpenLP.isBlank === true            // depending on your version
    ) {
      // Completely hide overlay
      $("#currentslide").html("");
      $("#nextslide").html("");
      return;
    }


    // ---------------------------------------------------------
    // 2. NORMAL SLIDE MODE
    // ---------------------------------------------------------

    // Verse tag highlight
    $("#verseorder span").removeClass("currenttag");
    $("#tag" + OpenLP.currentTags[OpenLP.currentSlide]).addClass("currenttag");

    var slide = OpenLP.currentSlides[OpenLP.currentSlide];

    // For lyric overlay, only use slide["text"] for current slide
    var rawText = slide["text"];
    var isEmpty = (!rawText || /^\s*$/.test(rawText));

    if (isEmpty) {
      // Empty lyric → hide completely
      $("#currentslide").html("");
    }
    else {
      // Real lyric: convert newlines to <br />
      var text = rawText
        .replace(/\r/g, "")
        .replace(/\n/g, "<br />");

      $("#currentslide").html(text);
    }

    // ----------------------
    // NEXT SLIDE RENDERING
    // (kept for compatibility, normally hidden in CSS)
    // ----------------------

    var nextText = "";

    if (OpenLP.currentSlide < OpenLP.currentSlides.length - 1) {
      for (var idx = OpenLP.currentSlide + 1; idx < OpenLP.currentSlides.length; idx++) {

        if (OpenLP.currentTags[idx] != OpenLP.currentTags[idx - 1])
          nextText += "<p class=\"nextslide\">";

        if (OpenLP.currentSlides[idx]["text"])
          nextText += OpenLP.currentSlides[idx]["text"];
        else
          nextText += OpenLP.currentSlides[idx]["title"];

        if (OpenLP.currentTags[idx] != OpenLP.currentTags[idx - 1])
          nextText += "</p>";
        else
          nextText += "<br />";
      }

      nextText = nextText.replace(/\n/g, "<br />");
      $("#nextslide").html(nextText);
    }
    else {
      nextText =
        "<p class=\"nextslide\">" +
        $("#next-text").val() +
        ": " +
        OpenLP.nextSong +
        "</p>";

      $("#nextslide").html(nextText);
    }
},


  updateClock: function (data) {
    var div = $("#clock");
    var t = new Date();
    var h = t.getHours();

    if (OpenLP.myTwelve && h > 12)
      h = h - 12;

    var m = t.getMinutes();
    if (m < 10)
      m = "0" + m;

    div.html(h + ":" + m);
  },
};

$.ajaxSetup({ cache: false });
setInterval("OpenLP.updateClock();", 500);
OpenLP.myWebSocket();
