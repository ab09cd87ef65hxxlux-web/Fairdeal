public with sharing class dataTableCtrlProposal {

    @AuraEnabled(cacheable=true)
    public static List<AccountWrapper> fetchAccountWrapper(Id recordId) {
        List<AccountWrapper> wrappers = new List<AccountWrapper>();
        // TODO: implement real query against Project_Property__c / Property_Transaction__c
        // mapped from recordId (Enquiry__c or similar).
        return wrappers;
    }

    @AuraEnabled
    public static void generatePdfs(
        Id recordId,
        String selectedProperties,
        String format,
        Boolean TermsandConditions,
        Boolean saveButton
    ) {
        // TODO: implement PDF generation via Visualforce page + ContentVersion,
        // email when saveButton == true.
    }

    public class AccountWrapper {
        @AuraEnabled public PropertyTransaction objPro { get; set; }
    }

    public class PropertyTransaction {
        @AuraEnabled public Id Id { get; set; }
        @AuraEnabled public String Property_Name__c { get; set; }
        @AuraEnabled public String Unit_Number__c { get; set; }
        @Aura-enabled public Id Project_Property__c { get; set; }
        @Aura-enabled public ProjectProperty Project_Property__r { get; set; }
        @Aura-enabled public Enquiry Enquiry__r { get; set; }
        @Aura-enabled public Decimal Quoted_Lease_Price_Carpet__c { get; set; }
        @Aura-enabled public Decimal Quoted_Lease_Price_Saleable__c { get; set; }
        @Aura-enabled public Decimal Quoted_Price_Carpet__c { get; set; }
        @Aura-enabled public Decimal Quoted_Price__c { get; set; }
        @Aura-enabled public Decimal Total_Lease_Price__c { get; set; }
        @Aura-enabled public Decimal Total_Price__c { get; set; }
    }

    public class ProjectProperty {
        @Aura-enabled public Id Id { get; set; }
        @Aura-enabled public String Name { get; set; }
        @Aura-enabled public String Property_Type1__c { get; set; }
        @Aura-enabled public Decimal Saleable_Area__c { get; set; }
        @Aura-enabled public Decimal Carpet_Area__c { get; set; }
        @Aura-enabled public String Furnishing__c { get; set; }
        @Aura-enabled public String Suitable_For__c { get; set; }
        @Aura-enabled public String Sub_Location__c { get; set; }
        @Aura-enabled public Integer Last_Updated_Days__c { get; set; }
        @Aura-enabled public Decimal Workstations__c { get; set; }
        @Aura-enabled public Date Possession__c { get; set; }
        @Aura-enabled public String Unit_Number__c { get; set; }
    }

    public class Enquiry {
        @Aura-enabled public Id Id { get; set; }
        @Aura-enabled public String Name { get; set; }
        @Aura-enabled public String Want_To__c { get; set; }
    }
}
