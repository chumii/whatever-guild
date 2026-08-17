-- KeystoneTrader.lua
-- Automates keystone downgrading at the Keystone Custodian NPC.
-- Toggle: /wb trade    (persists in SavedVariables)
--
-- ── Constants: verify / update each expansion or patch ───────────────────
-- Run these while in-game and paste the output to update constants below:
--
--   While TARGETING the custodian NPC:
--     /dump select(6, strsplit("-", UnitGUID("target")))   → NPC_ID
--     /dump UnitName("target")                             → NPC_NAME
--
--   While STANDING at the custodian (not in gossip):
--     /dump C_Map.GetBestMapForUnit("player")              → ZONE_MAP_ID
--
--   RIGHT AFTER opening gossip with the custodian:
--     /dump C_GossipInfo.GetOptions()                      → gossip option .name fields
--
--   When key reaches target level (NPC says something):
--     /dump C_GossipInfo.GetText()                         → GOSSIP_DONE_TEXT

WB = WB or {}

local NPC_NAME        = "Lindormi"    -- Lindormi, Dornogal — for targeting and chat messages
local KEYSTONE_ITEM   = 180653        -- Mythic Keystone (stable across seasons)
local ZONE_MAP_ID     = 2393          -- Lindormi's location map ID (verified 2026-05-08)

local GOSSIP_DOWNGRADE = "My Keystone level is too high. Can you reduce it?"
local GOSSIP_DONE_TEXT = "Here, give this one a try!"

-- ─────────────────────────────────────────────────────────────────────────

local enabled     = true  -- default on; overridden by SavedVariables on ADDON_LOADED
local keyLevel    = 0
local targetLevel = 0
local onHover     = false
local locked      = false     -- true while waiting for BAG_UPDATE after a trade
local transiting  = false     -- true between DONE_TEXT unlock and next BAG_UPDATE(lv>0)
local bindActive  = false
local built       = false

local mainFrame, iconArea, upBtn, downBtn, curLabel, origLabel

-- ── Helpers ───────────────────────────────────────────────────────────────

local function readKeyLevel()
    return C_MythicPlus.GetOwnedKeystoneLevel() or 0
end

local function hasKey()
    return GetItemCount(KEYSTONE_ITEM) > 0
end

-- UnitGUID can return a "secret string" when called during PLAYER_TARGET_CHANGED
-- fired from a protected function (e.g. CameraOrSelectOrMoveStop), causing a
-- taint error on strsplit. UnitName is not secret and sufficient here when
-- combined with the zone check.
local function isTargetNpc()
    return UnitName("target") == NPC_NAME
end

local function shouldShow()
    if not enabled then return false end
    if not hasKey() then return false end
    if not isTargetNpc() then return false end
    local mapID = C_Map.GetBestMapForUnit("player")
    return (mapID == ZONE_MAP_ID)
end

local function setBinding(active)
    if active == bindActive then return end
    if active then
        SetOverrideBinding(mainFrame, true, "MOUSEWHEELDOWN", "INTERACTTARGET")
    else
        ClearOverrideBindings(mainFrame)
    end
    bindActive = active
end

local function syncBinding()
    setBinding(onHover and not locked)
end

local function updateDisplay()
    if not built then return end
    if targetLevel == keyLevel then
        curLabel:SetText(keyLevel)
        curLabel:SetTextColor(0.2, 0.9, 0.2)
        origLabel:SetText("")
    else
        curLabel:SetText("|cffffff00" .. targetLevel .. "|r")
        origLabel:SetText(keyLevel)
    end
    upBtn:SetEnabled(targetLevel < keyLevel)
    downBtn:SetEnabled(targetLevel > 2)
end

local function hideAll()
    setBinding(false)
    onHover     = false
    locked      = false
    targetLevel = 0
    if mainFrame then mainFrame:Hide() end
end

-- ── Frame construction (deferred until first use) ─────────────────────────

local function buildUI()
    if built then return end
    built = true

    mainFrame = CreateFrame("Frame", "WBKeystoneTraderFrame", UIParent, "BackdropTemplate")
    mainFrame:SetSize(108, 72)
    mainFrame:SetPoint("CENTER", UIParent, "CENTER", 0, 200)
    mainFrame:SetMovable(true)
    mainFrame:EnableMouse(true)
    mainFrame:RegisterForDrag("LeftButton")
    mainFrame:SetScript("OnDragStart", mainFrame.StartMoving)
    mainFrame:SetScript("OnDragStop", mainFrame.StopMovingOrSizing)
    mainFrame:SetClampedToScreen(true)
    mainFrame:SetFrameStrata("HIGH")
    mainFrame:Hide()
    mainFrame:SetBackdrop({
        bgFile   = "Interface\\Buttons\\WHITE8X8",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile     = false,
        edgeSize = 10,
        insets   = { left = 2, right = 2, top = 2, bottom = 2 },
    })
    mainFrame:SetBackdropColor(0, 0, 0, 0.82)
    mainFrame:SetBackdropBorderColor(0.22, 0.22, 0.22, 1)

    -- +1 button — top of left column
    upBtn = CreateFrame("Button", "WBKTUpBtn", mainFrame, "UIPanelButtonTemplate")
    upBtn:SetSize(30, 24)
    upBtn:SetPoint("TOPLEFT", mainFrame, "TOPLEFT", 5, -8)
    upBtn:SetText("+1")
    upBtn:SetScript("OnClick", function()
        if targetLevel < keyLevel then
            targetLevel = targetLevel + 1
            updateDisplay()
        end
        C_GossipInfo.CloseGossip()
    end)

    -- -1 button — directly below +1, 4px gap
    downBtn = CreateFrame("Button", "WBKTDownBtn", mainFrame, "UIPanelButtonTemplate")
    downBtn:SetSize(30, 24)
    downBtn:SetPoint("TOP", upBtn, "BOTTOM", 0, -4)
    downBtn:SetText("-1")
    downBtn:SetScript("OnClick", function()
        if targetLevel > 2 then
            targetLevel = targetLevel - 1
            updateDisplay()
        end
        C_GossipInfo.CloseGossip()
    end)

    -- Icon area — right column. Hover here to activate the scroll binding.
    iconArea = CreateFrame("Frame", "WBKTIconArea", mainFrame)
    iconArea:SetSize(52, 52)
    iconArea:SetPoint("TOPLEFT", mainFrame, "TOPLEFT", 40, -8)
    iconArea:EnableMouse(true)

    local iconTex = iconArea:CreateTexture(nil, "ARTWORK")
    iconTex:SetAllPoints()
    iconTex:SetTexture(525134)  -- keystone icon

    iconArea:SetScript("OnEnter", function()
        onHover = true
        syncBinding()
        GameTooltip:SetOwner(iconArea, "ANCHOR_RIGHT")
        GameTooltip:AddLine("Keystone Trader", 1, 0.82, 0)
        GameTooltip:AddLine("Hover here and scroll down to interact with " .. NPC_NAME .. ".", 1, 1, 1, true)
        GameTooltip:AddLine("Each scroll lowers your key by 1.", 0.6, 0.6, 0.6, true)
        GameTooltip:Show()
    end)

    -- Ignore OnLeave while locked: the gossip frame stealing focus fires a
    -- spurious leave even though the cursor hasn't moved off the icon.
    iconArea:SetScript("OnLeave", function()
        if not locked then
            onHover = false
            syncBinding()
        end
        GameTooltip:Hide()
    end)

    -- Target level (large, centered on icon)
    curLabel = iconArea:CreateFontString(nil, "OVERLAY")
    curLabel:SetFont(select(1, GameFontNormal:GetFont()), 22, "OUTLINE")
    curLabel:SetPoint("CENTER", iconArea, "CENTER")
    curLabel:SetTextColor(0.2, 0.9, 0.2)

    -- Original key level (small, top-right corner, shown when target differs)
    origLabel = iconArea:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    origLabel:SetPoint("TOPRIGHT", iconArea, "TOPRIGHT", 4, 4)
    origLabel:SetTextColor(0.5, 0.5, 0.5)
end

-- ── Core logic ─────────────────────────────────────────────────────────────

local function refresh()
    if shouldShow() then
        if not built then buildUI() end
        local lv = readKeyLevel()
        local freshTarget = not mainFrame or not mainFrame:IsShown()
        keyLevel = lv
        if freshTarget or targetLevel == 0 or targetLevel > keyLevel then
            targetLevel = keyLevel
        end
        updateDisplay()
        mainFrame:Show()
    elseif not locked then
        -- Don't hide while locked: the keystone briefly leaves the bag during
        -- the Lindormi exchange, which would make IsMouseOver() return false on
        -- a hidden frame and permanently lose the hover/binding state.
        hideAll()
    end
end

-- ── Event handler ─────────────────────────────────────────────────────────

local ev = CreateFrame("Frame")
ev:RegisterEvent("ADDON_LOADED")
ev:RegisterEvent("PLAYER_ENTERING_WORLD")
ev:RegisterEvent("PLAYER_TARGET_CHANGED")
ev:RegisterEvent("ZONE_CHANGED")
ev:RegisterEvent("ZONE_CHANGED_NEW_AREA")
ev:RegisterEvent("BAG_UPDATE_DELAYED")
ev:RegisterEvent("GOSSIP_SHOW")

ev:SetScript("OnEvent", function(_, event, arg1)
    if event == "ADDON_LOADED" then
        if arg1 ~= "WhateverBoosting" then return end
        local db = WhateverBoostingDB
        if db and db.keystoneTraderEnabled ~= nil then
            enabled = db.keystoneTraderEnabled
        end
        return
    end

    if not enabled then return end

    if event == "PLAYER_ENTERING_WORLD" or event == "PLAYER_TARGET_CHANGED"
       or event == "ZONE_CHANGED" or event == "ZONE_CHANGED_NEW_AREA" then
        refresh()

    elseif event == "BAG_UPDATE_DELAYED" then
        local lv = readKeyLevel()
        if lv == 0 and (locked or transiting) then
            return
        end
        if lv ~= keyLevel then
            transiting = false
            keyLevel   = lv
            locked     = false
            if keyLevel == 0 then
                targetLevel = 0
                hideAll()
            else
                if targetLevel == 0 or targetLevel > keyLevel then targetLevel = keyLevel end
                if built and iconArea then onHover = iconArea:IsMouseOver() end
                syncBinding()
                updateDisplay()
            end
        else
            transiting = false
        end
        refresh()

    elseif event == "GOSSIP_SHOW" then
        if not isTargetNpc() then return end

        -- Refresh keyLevel from game state — may lag behind actual level when
        -- scrolling faster than BAG_UPDATE_DELAYED fires.
        local freshLv = readKeyLevel()
        if freshLv > 0 then keyLevel = freshLv end

        local gossipText = C_GossipInfo.GetText() or ""

        if gossipText == GOSSIP_DONE_TEXT then
            C_GossipInfo.CloseGossip()
            locked     = false
            transiting = true
            if built and iconArea then onHover = iconArea:IsMouseOver() end
            syncBinding()
            return
        end

        if keyLevel <= targetLevel then
            C_GossipInfo.CloseGossip()
            return
        end

        if locked then return end

        local opts = C_GossipInfo.GetOptions()
        for _, opt in ipairs(opts) do
            if opt.name == GOSSIP_DOWNGRADE then
                locked = true
                syncBinding()
                C_GossipInfo.SelectOption(opt.gossipOptionID, nil, true)
                return
            end
        end
    end
end)

-- ── Module API ────────────────────────────────────────────────────────────

WB.KeystoneTrader = {
    Toggle = function()
        enabled = not enabled
        if WhateverBoostingDB then
            WhateverBoostingDB.keystoneTraderEnabled = enabled
        end
        if enabled then
            refresh()
            DEFAULT_CHAT_FRAME:AddMessage("|cff00ccff[WB]|r Keystone Trader |cff00ff00enabled|r")
        else
            hideAll()
            DEFAULT_CHAT_FRAME:AddMessage("|cff00ccff[WB]|r Keystone Trader |cffff4444disabled|r")
        end
    end,
    IsEnabled = function() return enabled end,
}
