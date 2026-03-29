// Clamp a numeric value into an allowed range.
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// Compute how many state bits are needed for a given number of states.
export function bitsForCount(count) {
    return count <= 1 ? 1 : Math.ceil(Math.log2(count));
}

// Convert a decimal number into a fixed-width binary string.
export function toBitString(value, width) {
    return value.toString(2).padStart(width, '0');
}

// Sanitize user-entered transition text so only a valid binary pattern survives.
export function normalizeBitPattern(value, width) {
    if (width <= 0) {
        return '';
    }

    const cleaned = String(value ?? '')
        .trim()
        .replace(/\s+/g, '')
        .replace(/[^01]/g, '');

    if (cleaned.length !== width) {
        return null;
    }

    return cleaned;
}

// Treat any non-1 value as 0 so output fields stay binary.
export function coerceBit(value) {
    return String(value).trim() === '1' ? 1 : 0;
}

// Render numeric sets in a compact human-readable way for the report tables.
export function formatNumberList(values) {
    return values.length > 0 ? values.join(', ') : 'none';
}

// Join signal names for status and report text.
export function joinNames(values) {
    return values.length > 0 ? values.join(', ') : 'none';
}

// Escape interpolated text before placing it into HTML strings.
export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
