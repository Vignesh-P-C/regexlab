#pragma once
#include <string>
#include <vector>
namespace regexlab {
inline std::string encodeCharacterSet(const std::vector<int>& characters) {
    static constexpr char hex[] = "0123456789abcdef"; int nibbles[32] = {};
    for (int c : characters) if (c >= 0 && c <= 127) nibbles[c >> 2] |= 1 << (c & 3);
    std::string label = "cs:"; for (int n : nibbles) label.push_back(hex[n]); return label;
}
inline bool isCharacterSetLabel(const std::string& label) {
    if (label.size() != 35 || label.compare(0, 3, "cs:") != 0) return false;
    for (size_t i = 3; i < label.size(); ++i)
        if (!((label[i] >= '0' && label[i] <= '9') || (label[i] >= 'a' && label[i] <= 'f'))) return false;
    return true;
}
inline std::vector<int> decodeCharacterSet(const std::string& label) {
    std::vector<int> out; if (!isCharacterSetLabel(label)) return out;
    for (int i = 0; i < 32; ++i) {
        char c = label[3 + i]; int n = c <= '9' ? c - '0' : c - 'a' + 10;
        for (int bit = 0; bit < 4; ++bit) if (n & (1 << bit)) out.push_back(i * 4 + bit);
    }
    return out;
}
inline bool transitionMatches(const std::string& label, char ch) {
    if (label == "eps") return false;
    if (!isCharacterSetLabel(label)) return label == std::string(1, ch);
    unsigned char c = static_cast<unsigned char>(ch); if (c > 127) return false;
    char h = label[3 + (c >> 2)]; int n = h <= '9' ? h - '0' : h - 'a' + 10;
    return (n & (1 << (c & 3))) != 0;
}
} // namespace regexlab
