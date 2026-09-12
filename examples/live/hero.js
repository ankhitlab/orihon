import { createMap } from "orihon/easy";

export function createHero({ container, dark }) {
  const map = createMap(container, {
    center: { lat: 52.5175, lng: 13.3925 },
    zoom: 13,
    basemap: {
      url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${
        dark ? "Dark" : "Light"
      }_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      attribution: "Tiles © Esri",
      maxNativeZoom: 16
    }
  });

  map.addPolygon({
    rings: [
      { lat: 52.5085, lng: 13.3705 }, { lat: 52.5265, lng: 13.3660 },
      { lat: 52.5310, lng: 13.4025 }, { lat: 52.5135, lng: 13.4120 }
    ],
    style: { fill: "#2d7285", fillOpacity: 0.16, stroke: "#2d7285", strokeWidth: 2 },
    popup: "Service area"
  });

  map.addPolyline({
    points: [
      { lat: 52.5251, lng: 13.3694 }, { lat: 52.5186, lng: 13.3760 },
      { lat: 52.5170, lng: 13.3900 }, { lat: 52.5219, lng: 13.4132 }
    ],
    style: { stroke: "#c1501f", strokeWidth: 4, arrow: "end" },
    tooltip: "Morning route"
  });

  map.addMarker({
    position: { lat: 52.5219, lng: 13.4132 },
    appearance: { shape: "pin", color: "#b6820a" },
    popup: "Alexanderplatz — last stop"
  });

  return map;
}
