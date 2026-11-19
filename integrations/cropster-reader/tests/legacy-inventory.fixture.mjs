export function legacyInventorySnapshot() {
  return {
    url: "https://c-sar.cropster.com/apps/lots/inventory-report?pageSize=100",
    text: "Green Inventory Report for February 5, 2026. Values refer to the inventory on February 5, 2026. Green Inventory Overview Values refer to the inventory on February 5, 2026. 120 kg 1,240 AUD 2 Locations 3 # of lots By lot",
    legacyInventoryScope: {
      locationControls: [{ selected: [], text: "" }], consumedControls: [{ checked: false }], checkedRows: 0,
      nonCheckboxInputs: [{ type: "text", value: "" }, { type: "text", value: "" }],
      snapshotButtons: [{ text: "Snapshot Report", class: "button active ember-view", pressed: null }, { text: "Timeframe Report", class: "button ember-view", pressed: null }],
    },
    tables: [{
      headers: ["", "Lot ID-Tag", "Name", "Weight (kg)", "Weight", "Total value", "Location", "Price", "Used in profiles", "Run out estimation"],
      rows: [["", "PG-0901", "Example A", "10 kg", "10 kg", "$ 100.00 AUD", "Marrickville", "10 $ / kg", "", ""], ["", "PG-0901", "Example A", "90 kg", "90 kg", "$ 900.00 AUD", "Supplier", "10 $ / kg", "", ""], ["", "PG-0902", "Example B", "20 kg", "20 kg", "$ 240.00 AUD", "Marrickville", "12 $ / kg", "", ""]],
      rowLinks: ["PositionA", "PositionB", "PositionC"].map((id, index) => [{ text: index < 2 ? "PG-0901" : "PG-0902", href: "https://c-sar.cropster.com/apps/lots/inventory/" + id }]),
      footers: [["", "Total - page: 3", "", "120 kg", "", "$ 1,240.00 AUD", "Count: 2", "", "", ""]],
      pagination: "Show 1 - 3 of 3",
    }],
  };
}
