// Representative island positions from the official MAE geographic gazetteer:
// https://www.mae.gov.vn/noidung/Lists/VBQPPL/Attachments/514/1_DanhMuc_TT_DiaDanh_BanHanh.pdf
// Source coordinates use VN-2000. DMS values are converted to decimal degrees
// without a datum transformation, for approximate schematic map symbols only.
// Group anchors use the gazetteer's named-group reference positions.
// Projected with the bundled map's Natural Earth 1 projection:
// scale 145.0501960949437, translate [400, 239.41623551536887].
// Static geography is maintained separately from Analytics traffic data.

type ArchipelagoIsland = Readonly<{
  name: string;
  longitude: number;
  latitude: number;
  x: number;
  y: number;
}>;

type ArchipelagoReference = Readonly<{
  id: "hoang-sa" | "truong-sa";
  name: "Hoàng Sa" | "Trường Sa";
  x: number;
  y: number;
  islands: ReadonlyArray<ArchipelagoIsland>;
}>;

export const ARCHIPELAGO_REFERENCES: ReadonlyArray<ArchipelagoReference> = [
  {
    id: "hoang-sa",
    name: "Hoàng Sa",
    x: 644.250,
    y: 197.377,
    islands: [
      { name: "Hoàng Sa", longitude: 111.606111, latitude: 16.535556, x: 642.877, y: 197.201 },
      { name: "Hữu Nhật", longitude: 111.583889, latitude: 16.507222, x: 642.839, y: 197.273 },
      { name: "Quang Ảnh", longitude: 111.505556, latitude: 16.449167, x: 642.691, y: 197.422 },
      { name: "Quang Hòa", longitude: 111.710000, latitude: 16.452778, x: 643.134, y: 197.413 },
      { name: "Tri Tôn", longitude: 111.197500, latitude: 15.785833, x: 642.266, y: 199.119 },
      { name: "Phú Lâm", longitude: 112.333333, latitude: 16.836667, x: 644.342, y: 196.430 },
      { name: "Linh Côn", longitude: 112.726667, latitude: 16.671667, x: 645.263, y: 196.852 },
      { name: "Cây", longitude: 112.269722, latitude: 16.981111, x: 644.147, y: 196.060 },
    ],
  },
  {
    id: "truong-sa",
    name: "Trường Sa",
    x: 650.395,
    y: 216.948,
    islands: [
      { name: "Song Tử Tây", longitude: 114.329722, latitude: 11.430000, x: 650.487, y: 210.254 },
      { name: "Sơn Ca", longitude: 114.478333, latitude: 10.376667, x: 651.082, y: 212.944 },
      { name: "Nam Yết", longitude: 114.365000, latitude: 10.180000, x: 650.881, y: 213.446 },
      { name: "Sinh Tồn", longitude: 114.329167, latitude: 9.885833, x: 650.871, y: 214.197 },
      { name: "Trường Sa", longitude: 111.918333, latitude: 8.646667, x: 645.844, y: 217.361 },
      { name: "Phan Vinh", longitude: 113.707222, latitude: 8.976944, x: 649.706, y: 216.518 },
      { name: "An Bang", longitude: 112.919722, latitude: 7.893333, x: 648.188, y: 219.283 },
      { name: "Tiên Nữ", longitude: 114.655000, latitude: 8.855000, x: 651.813, y: 216.829 },
    ],
  },
];
