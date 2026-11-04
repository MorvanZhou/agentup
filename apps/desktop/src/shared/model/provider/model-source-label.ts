/**
 * 模型行接入标签文案。
 * 优先模板 label（DeepSeek Harness）；缺省再拼厂商 · 接入方式。
 */

/** 与设置页供应商筛选同一套：模板名 → 厂商 · 接入方式 → 厂商 */
export function modelSourceLabel(model: {
  label?: string;
  vendorLabel: string;
  optionLabel: string;
}): string {
  const named = model.label?.trim();
  if (named) return named;
  return model.optionLabel !== model.vendorLabel
    ? `${model.vendorLabel} · ${model.optionLabel}`
    : model.vendorLabel;
}
