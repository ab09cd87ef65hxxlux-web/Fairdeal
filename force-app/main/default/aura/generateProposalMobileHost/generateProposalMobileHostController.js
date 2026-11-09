({
  handleClose: function (component, event, helper) {
    var closeQuickAction = $A.get("e.force:closeQuickAction");
    closeQuickAction.fire();
  }
})
