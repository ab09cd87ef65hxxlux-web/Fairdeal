import { LightningElement, api, wire } from "lwc";
import { CloseActionScreenEvent } from "lightning/actions";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { getRecord, notifyRecordUpdateAvailable } from "lightning/uiRecordApi";
import { CurrentPageReference } from "lightning/navigation";
import { NavigationMixin } from "lightning/navigation";
import fetchAccountWrapper from "@salesforce/apex/dataTableCtrlProposal.fetchAccountWrapper";
import generatePdfs from "@salesforce/apex/dataTableCtrlProposal.generatePdfs";

const PAGE_SIZE = 10;
const RECORD_ID_WAIT_MS = 8000;

const STEP_SELECT = "select";
const STEP_REVIEW = "review";
const STEP_DONE = "done";

const LEASE = ["Lease", "Both"];
const BUY = ["Buy", "Both"];

const RECIPIENT_FIELDS = [
  "Enquiry__c.Contact__r.Name",
  "Enquiry__c.Contact__r.Email"
];

const COLUMN_DEFS = [
  { key: "propertyType", label: "Type" },
  { key: "saleableArea", label: "Saleable area", numeric: true },
  { key: "carpetArea", label: "Carpet area", numeric: true },
  { key: "furnishing", label: "Furnishing" },
  { key: "suitableFor", label: "Ideal for", wrap: true },
  {
    key: "leaseCarpet",
    label: "Quoted lease (carpet)",
    numeric: true,
    showFor: LEASE
  },
  {
    key: "leaseSaleable",
    label: "Quoted lease (saleable)",
    numeric: true,
    showFor: LEASE
  },
  {
    key: "buyCarpet",
    label: "Quoted price (carpet)",
    numeric: true,
    showFor: BUY
  },
  {
    key: "buySaleable",
    label: "Quoted price (saleable)",
    numeric: true,
    showFor: BUY
  },
  { key: "totalLease", label: "Total lease price", numeric: true, showFor: LEASE },
  { key: "totalBuy", label: "Total sales price", numeric: true, showFor: BUY },
  { key: "subLocation", label: "Sub location", wrap: true },
  { key: "lastUpdated", label: "Updated (days)", numeric: true }
];

const FORMAT_OPTIONS = [
  { label: "Initial proposal", value: "InitialProposal" },
  { label: "Detailed proposal", value: "DetailedProposal" }
];

const cellClassFor = (col) => {
  return [
    "cell",
    col.numeric ? "cell_numeric" : "",
    col.wrap ? "cell_wrap" : ""
  ]
    .filter(Boolean)
    .join(" ");
};

const NUMBER = new Intl.NumberFormat("en-IN");

const isBlank = (value) =>
  value === null || value === undefined || value === "";

const formatNumber = (value) => (isBlank(value) ? "-" : NUMBER.format(value));

const formatList = (value) => {
  return isBlank(value) ? "-" : String(value).split(";").join(", ");
};

const formatText = (value) => (isBlank(value) ? "-" : value);

const formatDays = (days) => {
  if (isBlank(days)) {
    return "-";
  }
  return days === 0 ? "Today" : String(days);
};

const extractErrorMessage = (error) => {
  const body = error && error.body;
  if (Array.isArray(body) && body.length) {
    return body.map((e) => e.message).join(" ");
  }
  if (body && body.message) {
    return body.message;
  }
  if (body && body.pageErrors && body.pageErrors.length) {
    return body.pageErrors[0].message;
  }
  if (error && error.message) {
    return error.message;
  }
  return "An unexpected error occurred.";
};

const psfFields = {
  lease: { psf: "Quoted_Lease_Price_Saleable__c", area: "Saleable_Area__c", total: "Total_Lease_Price__c" },
  buy: { psf: "Quoted_Price__c", area: "Saleable_Area__c", total: "Total_Price__c" }
};

export default class GenerateProposalMobile extends NavigationMixin(LightningElement) {
  @api embedded = false;

  _recordId;

  @api
  get recordId() {
    return this._recordId;
  }
  set recordId(value) {
    this.useRecordId(value);
  }

  useRecordId(id) {
    if (id && id !== this._recordId) {
      this._recordId = id;
      clearTimeout(this._missingIdTimer);
      this.loadProperties();
    }
  }

  formatOptions = FORMAT_OPTIONS;

  step = STEP_SELECT;
  isLoading = true;
  loadError;
  isGenerating = false;
  generateError;
  selectionError;
  formatError;

  wantTo;
  allRows = [];
  currentPage = 1;

  selectedFormat;
  includeTerms = false;
  saveAndSend = false;
  lastAction;

  recipient;

  // Edit modal state
  showEditModal = false;
  editingKey = null;
  editableFields = [];

  // Per-row unit visibility
  unitShownByKey = new Map();
  // Per-row eye visibility for proposal
  eyeHiddenByKey = new Map();
  // Per-row edited state + original values
  editedByKey = new Map();
  originalValuesByKey = new Map();

  connectedCallback() {
    if (!this._recordId) {
      this._missingIdTimer = setTimeout(() => {
        if (!this._recordId) {
          this.isLoading = false;
          this.loadError =
            "We couldn't tell which record this action was opened from. Close it and open it again from the record.";
        }
      }, RECORD_ID_WAIT_MS);
    }
  }

  disconnectedCallback() {
    clearTimeout(this._missingIdTimer);
  }

  @wire(CurrentPageReference)
  wiredPageReference(pageRef) {
    const id =
      pageRef &&
      ((pageRef.attributes && pageRef.attributes.recordId) ||
        (pageRef.state && pageRef.state.recordId));
    if (id) {
      this.useRecordId(id);
    }
  }

  @wire(getRecord, { recordId: "$recordId", fields: RECIPIENT_FIELDS })
  wiredRecipient({ data, error }) {
    if (data) {
      const contact = data.fields.Contact__r && data.fields.Contact__r.value;
      this.recipient = contact
        ? {
            name: contact.fields.Name.value,
            email: contact.fields.Email.value || null
          }
        : { name: null, email: null };
    } else if (error) {
      this.recipient = undefined;
    }
  }

  loadProperties() {
    this.isLoading = true;
    this.loadError = undefined;
    this.selectionError = undefined;
    this.unitShownByKey.clear();
    this.eyeHiddenByKey.clear();
    this.editedByKey.clear();
    this.originalValuesByKey.clear();

    fetchAccountWrapper({ recordId: this.recordId })
      .then((result) => {
        const wrappers = result || [];
        const first = wrappers.length ? wrappers[0].objPro : undefined;
        this.wantTo =
          first && first.Enquiry__r ? first.Enquiry__r.Want_To__c : undefined;
        this.allRows = wrappers.map((w) => this.toRow(w));
        this.currentPage = 1;
      })
      .catch((error) => {
        this.allRows = [];
        this.loadError = extractErrorMessage(error);
      })
      .finally(() => {
        this.isLoading = false;
      });
  }

  toRow(wrapper) {
    const p = wrapper.objPro;
    const pp = p.Project_Property__r || {};
    const unit = formatText(p.Unit_Number__c || pp.Unit_Number__c);
    const mode = formatText(pp.Property_Type1__c) || "";
    const isLease = LEASE.includes(mode);
    const isBuy = BUY.includes(mode);
    const psfField = isLease ? psfFields.lease.psf : psfFields.buy.psf;
    const areaField = psfFields.lease.area;
    const totalField = isLease ? psfFields.lease.total : psfFields.buy.total;

    const psf = p[psfField];
    const area = pp[areaField];
    const originalTotal = p[totalField];

    return {
      key: p.Id,
      isChecked: false,
      name: formatText(p.Property_Name__c),
      unitNumber: unit || "209",
      unitShown: false,
      unitToggleTitle: unit ? "Hide Unit" : "Show Unit",
      unitToggleIcon: unit ? "utility:hide" : "utility:show",
      edited: false,
      values: {
        propertyType: formatText(pp.Property_Type1__c),
        saleableArea: formatNumber(pp.Saleable_Area__c),
        carpetArea: formatNumber(pp.Carpet_Area__c),
        furnishing: formatText(pp.Furnishing__c),
        suitableFor: formatList(pp.Suitable_For__c),
        leaseCarpet: formatNumber(p.Quoted_Lease_Price_Carpet__c),
        leaseSaleable: formatNumber(p.Quoted_Lease_Price_Saleable__c),
        buyCarpet: formatNumber(p.Quoted_Price_Carpet__c),
        buySaleable: formatNumber(p.Quoted_Price__c),
        totalLease: formatNumber(p.Total_Lease_Price__c),
        totalBuy: formatNumber(p.Total_Price__c),
        subLocation: formatText(pp.Sub_Location__c),
        lastUpdated: formatDays(pp.Last_Updated_Days__c)
      },
      raw: {
        saleableArea: pp.Saleable_Area__c,
        carpetArea: pp.Carpet_Area__c,
        psf: psf,
        total: originalTotal,
        workstations: pp.Workstations__c,
        furnishing: pp.Furnishing__c,
        possession: pp.Possession__c,
        suitableFor: pp.Suitable_For__c
      },
      cells: [],
      isLease,
      isBuy
    };
  }

  get columns() {
    return COLUMN_DEFS.filter(
      (c) => !c.showFor || c.showFor.includes(this.wantTo)
    ).map((c) => ({
      ...c,
      headerClass: cellClassFor(c)
    }));
  }

  get visibleRows() {
    const columns = this.columns;
    const start = (this.currentPage - 1) * PAGE_SIZE;
    return this.allRows.slice(start, start + PAGE_SIZE).map((row) => {
      const cells = columns.map((c) => {
        const value = this.getCellValue(row, c);
        return {
          key: c.key,
          label: c.label,
          value: value,
          cellClass: cellClassFor(c),
          edited: this.isCellEdited(row, c.key)
        };
      });
      return {
        ...row,
        rowClass: row.isChecked ? "row row_selected" : "row",
        ariaLabel: `Select ${row.name}`,
        cells
      };
    });
  }

  getCellValue(row, col) {
    const key = col.key;
    const edited = this.editedByKey.get(row.key);
    if (edited && edited[key] !== undefined) {
      return { displayValue: this.formatCellValue(col, edited[key]), raw: edited[key] };
    }
    const raw = row.raw[key] !== undefined ? row.raw[key] : row.values[key];
    return { displayValue: this.formatCellValue(col, raw), raw };
  }

  formatCellValue(col, value) {
    if (col.numeric) {
      return formatNumber(value);
    }
    return formatText(value);
  }

  isCellEdited(row, key) {
    const edited = this.editedByKey.get(row.key);
    return !!(edited && edited[key] !== undefined);
  }

  cellValueClass(cell) {
    return [
      "cell-value",
      cell.edited ? "cell-value_edited" : ""
    ].filter(Boolean).join(" ");
  }

  get selectedRows() {
    return this.allRows.filter((r) => r.isChecked);
  }

  get selectedCount() {
    return this.selectedRows.length;
  }

  get totalCount() {
    return this.allRows.length;
  }

  get hasRecords() {
    return this.totalCount > 0;
  }

  get hasNoRecords() {
    return !this.isLoading && !this.loadError && this.totalCount === 0;
  }

  get showList() {
    return !this.isLoading && !this.loadError && this.hasRecords;
  }

  get cannotContinue() {
    return !this.showList;
  }

  get allSelected() {
    return this.hasRecords && this.selectedCount === this.totalCount;
  }

  get selectionSummary() {
    return `${this.selectedCount} of ${this.totalCount} selected`;
  }

  get totalPages() {
    return Math.max(1, Math.ceil(this.totalCount / PAGE_SIZE));
  }

  get pageLabel() {
    return `Page ${this.currentPage} of ${this.totalPages}`;
  }

  get isFirstPage() {
    return this.currentPage <= 1;
  }

  get isLastPage() {
    return this.currentPage >= this.totalPages;
  }

  get showPagination() {
    return this.totalPages > 1;
  }

  get showOwnHeader() {
    return String(this.embedded) !== "true";
  }

  get isSelectStep() {
    return this.step === STEP_SELECT;
  }

  get isReviewStep() {
    return this.step === STEP_REVIEW;
  }

  get isDoneStep() {
    return this.step === STEP_DONE;
  }

  get stepOneClass() {
    return this.isSelectStep ? "step step_current" : "step step_done";
  }

  get stepTwoClass() {
    return this.isReviewStep ? "step step_current" : "step";
  }

  get stepThreeClass() {
    return this.isDoneStep ? "step step_current" : "step step_done";
  }

  get stepOneCurrent() {
    return this.isSelectStep ? "step" : undefined;
  }

  get stepTwoCurrent() {
    return this.isReviewStep ? "step" : undefined;
  }

  get stepThreeCurrent() {
    return this.isDoneStep ? "step" : undefined;
  }

  get stepOneMark() {
    return this.isSelectStep ? "1" : "✓";
  }

  get stepTwoMark() {
    return this.isReviewStep ? "2" : "✓";
  }

  get stepThreeMark() {
    return "3";
  }

  get showProgress() {
    return !this.isDoneStep;
  }

  get wantToLabel() {
    return this.wantTo ? `Want to: ${this.wantTo}` : "";
  }

  get recipientLine() {
    if (!this.recipient || !this.recipient.email) {
      return "";
    }
    return this.recipient.name
      ? `${this.recipient.name} (${this.recipient.email})`
      : this.recipient.email;
  }

  get hasRecipientEmail() {
    return !!(this.recipient && this.recipient.email);
  }

  get missingRecipientEmail() {
    return !!this.recipient && !this.recipient.email;
  }

  get recipientUnknown() {
    return !this.recipient;
  }

  get recipientName() {
    return (this.recipient && this.recipient.name) || "The contact";
  }

  get reviewSummary() {
    const n = this.selectedCount;
    return `${n} ${n === 1 ? "property" : "properties"} selected`;
  }

  get selectedFormatLabel() {
    const opt = this.formatOptions.find((o) => o.value === this.selectedFormat);
    return opt ? opt.label : this.selectedFormat;
  }

  get successMessage() {
    const n = this.selectedCount;
    const base = `Proposal for ${n} ${n === 1 ? "property" : "properties"} was saved to the record`;
    if (this.lastAction !== "send") {
      return `${base}.`;
    }
    if (this.hasRecipientEmail) {
      return `${base} and sent to ${this.recipientLine}.`;
    }
    if (this.missingRecipientEmail) {
      return `${base}. It was not emailed because ${this.recipientName} has no email address.`;
    }
    return `${base}. It is emailed to the contact if they have an email address.`;
  }

  // ---- handlers: step 1 ------------------------------------------------

  handleRowSelection(event) {
    const key = event.target.dataset.key;
    const checked = event.target.checked;
    this.allRows = this.allRows.map((row) => {
      return row.key === key ? { ...row, isChecked: checked } : row;
    });
    this.selectionError = undefined;
  }

  handleSelectAll(event) {
    const checked = event.target.checked;
    this.allRows = this.allRows.map((row) => ({ ...row, isChecked: checked }));
    this.selectionError = undefined;
  }

  handleToggleUnit(event) {
    const key = event.target.dataset.key;
    const shown = this.unitShownByKey.get(key) === true;
    this.unitShownByKey.set(key, !shown);
    const row = this.allRows.find((r) => r.key === key);
    if (row) {
      row.unitShown = !shown;
      row.unitToggleTitle = !shown ? "Hide Unit" : "Show Unit";
      row.unitToggleIcon = !shown ? "utility:hide" : "utility:show";
    }
  }

  handleEditFields(event) {
    const key = event.currentTarget.dataset.key;
    const row = this.allRows.find((r) => r.key === key);
    if (!row) return;
    this.editingKey = key;
    this.showEditModal = true;
    const raw = row.raw;
    this.editableFields = [
      { key: "saleableArea", label: "Saleable Area", original: raw.saleableArea, value: raw.saleableArea },
      { key: "carpetArea", label: "Carpet Area", original: raw.carpetArea, value: raw.carpetArea },
      { key: "quotedPSF", label: "Quoted PSF", original: raw.psf, value: raw.psf },
      { key: "totalQuotedPrice", label: "Total Quoted Price", original: raw.total, value: raw.total },
      { key: "workstations", label: "Workstations", original: raw.workstations, value: raw.workstations },
      { key: "furnishing", label: "Furnishing", original: raw.furnishing, value: raw.furnishing },
      { key: "possession", label: "Possession", original: raw.possession, value: raw.possession },
      { key: "suitableFor", label: "Suitable For", original: raw.suitableFor, value: raw.suitableFor }
    ];
  }

  handleEditFieldChange(event) {
    const fieldKey = event.target.dataset.key;
    const value = event.target.value;
    const field = this.editableFields.find((f) => f.key === fieldKey);
    if (field) {
      field.value = value;
    }
    this.applyAutoCalc(fieldKey, value);
  }

  applyAutoCalc(fieldKey, value) {
    if (fieldKey !== "saleableArea" && fieldKey !== "quotedPSF") return;
    const areaField = this.editableFields.find((f) => f.key === "saleableArea");
    const psfField = this.editableFields.find((f) => f.key === "quotedPSF");
    const totalField = this.editableFields.find((f) => f.key === "totalQuotedPrice");
    if (!areaField || !psfField || !totalField) return;
    const area = Number(areaField.value);
    const psf = Number(psfField.value);
    if (!isNaN(area) && !isNaN(psf)) {
      totalField.value = (area * psf).toFixed(2);
    }
  }

  handleEditRestore() {
    const row = this.allRows.find((r) => r.key === this.editingKey);
    if (!row) return;
    this.showEditModal = false;
    this.editedByKey.delete(this.editingKey);
    row.edited = false;
    this.dispatchEvent(
      new ShowToastEvent({
        title: "Restored",
        message: "Original values restored for this property.",
        variant: "success"
      })
    );
  }

  handleEditCancel() {
    this.showEditModal = false;
    this.editingKey = null;
    this.editableFields = [];
  }

  handleEditApply() {
    const row = this.allRows.find((r) => r.key === this.editingKey);
    if (!row) return;
    const edits = {};
    let changed = false;
    this.editableFields.forEach((f) => {
      const mappedKey = this.mapFieldToColumn(f.key);
      if (mappedKey) {
        edits[mappedKey] = f.value;
        if (String(f.value) !== String(f.original)) {
          changed = true;
        }
      }
    });
    this.editedByKey.set(this.editingKey, edits);
    row.edited = changed;
    this.showEditModal = false;
    this.editingKey = null;
    this.editableFields = [];
    this.dispatchEvent(
      new ShowToastEvent({
        title: "Applied",
        message: "Proposal-specific changes applied.",
        variant: "success"
      })
    );
  }

  mapFieldToColumn(fieldKey) {
    const map = {
      saleableArea: "saleableArea",
      carpetArea: "carpetArea",
      quotedPSF: "psf",
      totalQuotedPrice: "total",
      workstations: "workstations",
      furnishing: "furnishing",
      possession: "possession",
      suitableFor: "suitableFor"
    };
    return map[fieldKey];
  }

  // ---- handlers: step 2 ------------------------------------------------

  handleBack() {
    this.generateError = undefined;
    this.step = STEP_SELECT;
  }

  handleFormatChange(event) {
    this.selectedFormat = event.detail.value;
    this.formatError = undefined;
  }

  handleTermsChange(event) {
    this.includeTerms = event.target.checked;
  }

  handleSaveAndSendToggle(event) {
    this.saveAndSend = event.target.checked;
  }

  handleToggleEye(event) {
    const key = event.target.dataset.key;
    const hidden = this.eyeHiddenByKey.get(key) === true;
    this.eyeHiddenByKey.set(key, !hidden);
    const row = this.allRows.find((r) => r.key === key);
    if (row) {
      row.eyeToggleTitle = !hidden ? "Hide unit in proposal" : "Show unit in proposal";
      row.eyeIcon = !hidden ? "utility:hide" : "utility:show";
    }
  }

  handleSave() {
    this.generate(false);
  }

  handleSaveAndSend() {
    this.generate(true);
  }

  generate(isSend) {
    if (this.isGenerating) {
      return;
    }
    if (!this.selectedFormat) {
      this.formatError = "Select a document format.";
      return;
    }
    this.formatError = undefined;
    this.generateError = undefined;
    this.isGenerating = true;
    this.lastAction = isSend ? "send" : "save";

    generatePdfs({
      recordId: this.recordId,
      selectedProperties: JSON.stringify(
        this.selectedRows.map((row) => ({ Id: row.key }))
      ),
      format: this.selectedFormat,
      TermsandConditions: this.includeTerms,
      saveButton: isSend
    })
      .then(() => {
        this.step = STEP_DONE;
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Success",
            message: isSend ? "Proposal saved and sent." : "Proposal saved.",
            variant: "success"
          })
        );
        return notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
      })
      .catch((error) => {
        if (this.step !== STEP_DONE) {
          this.generateError = extractErrorMessage(error);
        }
      })
      .finally(() => {
        this.isGenerating = false;
      });
  }

  // ---- handlers: shared ------------------------------------------------

  handleCancel() {
    this.closeAction();
  }

  handleClose() {
    this.closeAction();
  }

  closeAction() {
    this.dispatchEvent(new CloseActionScreenEvent());
    this.dispatchEvent(new CustomEvent("closeaction"));
  }

  // ---- sharing ---------------------------------------------------------

  handleShareWhatsApp() {
    this.share("whatsapp");
  }

  handleShareEmail() {
    this.share("email");
  }

  handleShareMore() {
    this.share("more");
  }

  share(channel) {
    const n = this.selectedCount;
    const message = `Proposal for ${n} ${n === 1 ? "property" : "properties"} generated.`;
    if (channel === "whatsapp") {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "WhatsApp",
          message: "Opening WhatsApp to share the proposal PDF.",
          variant: "info"
        })
      );
    } else if (channel === "email") {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Email",
          message: "Sending proposal PDF via email.",
          variant: "info"
        })
      );
    } else {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Share",
          message: "Opening device share sheet.",
          variant: "info"
        })
      );
    }
  }

  // ---- handlers: step 1 footer -----------------------------------------

  handlePreviousPage() {
    if (!this.isFirstPage) {
      this.currentPage -= 1;
    }
  }

  handleNextPage() {
    if (!this.isLastPage) {
      this.currentPage += 1;
    }
  }

  handleRetryLoad() {
    this.loadProperties();
  }

  handleContinue() {
    if (this.selectedCount === 0) {
      this.selectionError = "Select at least one property to continue.";
      return;
    }
    this.selectionError = undefined;
    this.step = STEP_REVIEW;
  }
}
