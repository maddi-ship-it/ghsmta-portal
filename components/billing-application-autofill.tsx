"use client";

import { useEffect, useState } from "react";

type SelectedSchool = {
  address: string;
  contactName: string;
  email: string;
  phone: string;
  schoolName: string;
  schoolType: string;
  selectedTrack: string;
};

function fieldValue(option: HTMLOptionElement, key: keyof DOMStringMap) {
  return option.dataset[key]?.trim() ?? "";
}

function setFormValue(
  form: HTMLFormElement,
  name: string,
  value: string,
) {
  const field = form.elements.namedItem(name);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement
  ) {
    field.value = value;
  }
}

function selectedSchoolFromOption(
  option: HTMLOptionElement | null,
): SelectedSchool | null {
  if (!option?.value) return null;

  return {
    address: fieldValue(option, "billingAddress"),
    contactName: fieldValue(option, "billingContactName"),
    email: fieldValue(option, "recipientEmail"),
    phone: fieldValue(option, "billingContactPhone"),
    schoolName: fieldValue(option, "schoolName"),
    schoolType: fieldValue(option, "schoolType"),
    selectedTrack: fieldValue(option, "selectedTrack"),
  };
}

export function BillingApplicationAutofill() {
  const [selectedSchool, setSelectedSchool] = useState<SelectedSchool | null>(
    null,
  );

  useEffect(() => {
    const select = document.getElementById("billing_application");
    if (!(select instanceof HTMLSelectElement)) return undefined;
    const form = select.form;
    if (!form) return undefined;

    const syncSelectedSchool = () => {
      const nextSchool = selectedSchoolFromOption(select.selectedOptions[0]);
      setSelectedSchool(nextSchool);
      if (!nextSchool) return;

      setFormValue(form, "billing_name", nextSchool.schoolName);
      setFormValue(form, "recipient_email", nextSchool.email);
      setFormValue(form, "billing_contact_name", nextSchool.contactName);
      setFormValue(form, "billing_contact_phone", nextSchool.phone);
      setFormValue(form, "billing_address", nextSchool.address);
    };

    syncSelectedSchool();
    select.addEventListener("change", syncSelectedSchool);
    return () => select.removeEventListener("change", syncSelectedSchool);
  }, []);

  if (!selectedSchool) {
    return (
      <small className="billing-selected-school-summary is-empty">
        Choose a school to fill the billing contact details.
      </small>
    );
  }

  return (
    <div className="billing-selected-school-summary">
      <span>
        <strong>School type</strong>
        {selectedSchool.schoolType || "Missing"}
      </span>
      <span>
        <strong>Track</strong>
        {selectedSchool.selectedTrack || "Missing"}
      </span>
      <span>
        <strong>Billing email</strong>
        {selectedSchool.email || "Missing"}
      </span>
    </div>
  );
}
