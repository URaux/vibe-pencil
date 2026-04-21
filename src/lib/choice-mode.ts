const SINGLE_CHOICE_PATTERNS = [
  /\b(single[- ]select|single choice|choose one|pick one|select one|one only|either\/?or|either or|yes\/no|yes or no|true\/false|binary|mutually exclusive|strictly exclusive)\b/i,
  /\b(one (tech stack|database|backend|framework|mode))\b/i,
  /(单选|只能选一|二选一|互斥|是\/否|非此即彼)/,
]

const MULTI_CHOICE_PATTERNS = [
  /\b(multi[- ]select|select all that apply|pick several|pick multiple|rank|ranking|priorit(?:y|ies|ize)|preferences?|prefer|important|importance|wishlist|features?|capabilities|requirements?|integrations?|workflows?|roles?|channels?|platforms?|tooling|tools|libraries|stack choices?|tech preferences?|tech stack|stacks?)\b/i,
  /(多选|可多选|排序|偏好|优先级|功能|特性|能力|需求|集成|流程|角色|渠道|平台|工具链|技术栈|技术偏好)/,
]

function normalizeChoiceText(question: string, options: string[]): string {
  return [question, ...options].join(' ').replace(/\s+/g, ' ').trim()
}

export function inferMultiSelect(question: string, options: string[] = []): boolean {
  const text = normalizeChoiceText(question, options)
  if (!text) return false
  if (SINGLE_CHOICE_PATTERNS.some((pattern) => pattern.test(text))) return false
  if (MULTI_CHOICE_PATTERNS.some((pattern) => pattern.test(text))) return true
  return false
}
